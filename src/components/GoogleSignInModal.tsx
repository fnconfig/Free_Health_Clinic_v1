/**
 * GoogleSignInModal — supports Google Identity Services (GIS) and Email/Password auth.
 * The Firebase SDK is NO longer used for authentication.
 *
 * Flow:
 * - Tab A: Google
 *   1. User clicks "Lanjutkan dengan Google"
 *   2. GIS One-Tap prompt fires (or a rendered Sign-In button as fallback)
 *   3. Google returns a signed ID-token (JWT)
 *   4. We POST the token to /api/auth/google for server-side verification
 *   5. Server verifies, upserts user in Supabase, returns user profile
 * - Tab B: Email & Password
 *   1. User selects Log In or Sign Up
 *   2. Server registers or authenticates credentials against the Supabase database
 * - Both:
 *   Validates role access, then calls onSuccess()
 */

import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X, Lock, Check } from "lucide-react";
import { GpibLogo } from "./GpibLogo";
import { requestGoogleIdToken, decodeIdToken, signOutGis } from "../gis-auth";

// --- Read GIS Client-ID from env (Vite exposes VITE_* vars to the browser) ---
const GIS_CLIENT_ID = (import.meta as any).env?.VITE_GOOGLE_CLIENT_ID ?? "";

interface GoogleSignInModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetRole: "PATIENT" | "DOCTOR" | "ADMIN" | null;
  onSuccess: (role: "PATIENT" | "DOCTOR" | "ADMIN") => void;
}

export const GoogleSignInModal: React.FC<GoogleSignInModalProps> = ({
  isOpen,
  onClose,
  targetRole,
  onSuccess,
}) => {
  const [stage, setStage] = useState<"SELECT" | "LOADING" | "SUCCESS">("SELECT");
  const [authMethod, setAuthMethod] = useState<"GOOGLE" | "EMAIL">("GOOGLE");
  const [emailMode, setEmailMode] = useState<"LOGIN" | "REGISTER">("LOGIN");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [hasConsented, setHasConsented] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const gisButtonRef = useRef<HTMLDivElement>(null);

  // Reset state each time the modal opens
  useEffect(() => {
    if (isOpen) {
      setStage("SELECT");
      setAuthMethod("GOOGLE");
      setEmailMode("LOGIN");
      setEmail("");
      setPassword("");
      setDisplayName("");
      setHasConsented(true);
      setErrorMsg(null);
    }
  }, [isOpen]);

  // Render the GIS fallback button once the modal is visible and method is GOOGLE
  useEffect(() => {
    if (!isOpen || stage !== "SELECT" || authMethod !== "GOOGLE" || !gisButtonRef.current) return;
    if (!window.google?.accounts?.id) return;

    window.google.accounts.id.initialize({
      client_id: GIS_CLIENT_ID,
      callback: handleCredentialResponse,
      auto_select: false,
      cancel_on_tap_outside: true,
    });

    // Render branded Google Sign-In button as a reliable fallback
    window.google.accounts.id.renderButton(gisButtonRef.current, {
      type: "standard",
      shape: "rectangular",
      theme: "outline",
      text: "signin_with",
      size: "large",
      locale: "id_ID",
      width: gisButtonRef.current.offsetWidth || 340,
    });
  }, [isOpen, stage, authMethod]);

  const getRoleTitle = () => {
    switch (targetRole) {
      case "PATIENT": return "Portal Pasien Jemaat";
      case "DOCTOR":  return "Konsol Dokter Relawan";
      case "ADMIN":   return "Sistem Pengawas Admin (Diakonia)";
      default:        return "Portal Terenkripsi";
    }
  };

  /**
   * Called by GIS after user selects a Google account.
   * `credential` is the signed ID-token JWT.
   */
  const handleCredentialResponse = async (response: { credential: string }) => {
    if (!response?.credential) {
      setErrorMsg("Tidak menerima kredensial dari Google. Silakan coba lagi.");
      return;
    }
    await processIdToken(response.credential);
  };

  const processIdToken = async (idToken: string) => {
    setStage("LOADING");
    setErrorMsg(null);

    try {
      // 1. Decode payload client-side (optimistic display only – not trusted)
      const profile = decodeIdToken(idToken);

      // 2. Send token to backend for verification + Supabase upsert
      const authRes = await fetch("/api/auth/google", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken, role: targetRole }),
      });

      if (!authRes.ok) {
        const body = await authRes.json().catch(() => ({}));
        throw new Error(body.error || "Verifikasi token gagal di server.");
      }

      const { accessGranted, reason } = await authRes.json();

      if (!accessGranted) {
        // Sign out GIS so the picker appears fresh next time
        signOutGis(profile.email);
        throw new Error(reason || "Akses ditolak untuk peran ini.");
      }

      // 3. Persist minimal session info in localStorage
      localStorage.setItem(
        "currentUser",
        JSON.stringify({ email: profile.email, name: profile.name, role: targetRole, picture: profile.picture })
      );

      setStage("SUCCESS");
      setTimeout(() => {
        if (targetRole) onSuccess(targetRole);
        setStage("SELECT");
        onClose();
      }, 1400);
    } catch (err: any) {
      console.error("GIS auth error:", err);
      setStage("SELECT");
      setErrorMsg(err.message || "Terjadi kesalahan. Silakan coba lagi.");
    }
  };

  const handleEmailAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hasConsented) {
      setErrorMsg("Harap setujui pernyataan kepatuhan sebelum melanjutkan.");
      return;
    }
    if (!email.trim() || !password.trim()) {
      setErrorMsg("Email dan password wajib diisi.");
      return;
    }
    if (emailMode === "REGISTER" && !displayName.trim()) {
      setErrorMsg("Nama Lengkap wajib diisi.");
      return;
    }

    setStage("LOADING");
    setErrorMsg(null);

    try {
      const endpoint = emailMode === "LOGIN" ? "/api/auth/email/login" : "/api/auth/email/register";
      const authRes = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          password: password.trim(),
          displayName: displayName.trim() || undefined,
          role: targetRole,
        }),
      });

      const body = await authRes.json().catch(() => ({}));

      if (!authRes.ok) {
        throw new Error(body.error || "Otentikasi email gagal.");
      }

      if (!body.accessGranted) {
        throw new Error(body.reason || "Akses ditolak untuk peran ini.");
      }

      // Persist user session info
      localStorage.setItem(
        "currentUser",
        JSON.stringify({
          email: body.user.email,
          name: body.user.displayName || body.user.email.split("@")[0],
          role: targetRole,
          picture: null,
        })
      );

      setStage("SUCCESS");
      setTimeout(() => {
        if (targetRole) onSuccess(targetRole);
        setStage("SELECT");
        onClose();
      }, 1400);
    } catch (err: any) {
      console.error("Email auth error:", err);
      setStage("SELECT");
      setErrorMsg(err.message || "Terjadi kesalahan. Silakan coba lagi.");
    }
  };

  /**
   * Programmatically trigger GIS One-Tap prompt.
   * Falls back gracefully if One-Tap is suppressed (e.g. browser blocks it).
   */
  const handleGoogleSignIn = () => {
    if (!hasConsented) {
      setErrorMsg("Harap setujui pernyataan kepatuhan sebelum melanjutkan.");
      return;
    }
    if (!GIS_CLIENT_ID) {
      setErrorMsg("VITE_GOOGLE_CLIENT_ID belum dikonfigurasi di file .env.");
      return;
    }
    if (!window.google?.accounts?.id) {
      setErrorMsg("Library Google Identity Services belum dimuat. Periksa koneksi internet Anda.");
      return;
    }

    // Re-initialize with our callback and prompt One-Tap
    window.google.accounts.id.initialize({
      client_id: GIS_CLIENT_ID,
      callback: handleCredentialResponse,
      auto_select: false,
      cancel_on_tap_outside: true,
    });

    requestGoogleIdToken(GIS_CLIENT_ID).catch((err) => {
      // One-Tap suppressed — the rendered button below is the fallback
      if (err.message !== "GIS_PROMPT_SUPPRESSED") {
        setErrorMsg(err.message);
      }
    });
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={stage === "SELECT" ? onClose : undefined}
          className="absolute inset-0 bg-slate-900/60 backdrop-blur-xs"
        />

        {/* Modal */}
        <motion.div
          initial={{ scale: 0.95, opacity: 0, y: 15 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: 15 }}
          transition={{ type: "spring", damping: 25, stiffness: 350 }}
          className="relative bg-white w-full max-w-md rounded-2xl shadow-2xl border border-slate-100 overflow-hidden font-sans z-10"
        >
          {/* Branded colour bar */}
          <div className="h-1.5 bg-gradient-to-r from-brand-blue via-brand-green to-emerald-400" />

          {stage === "SELECT" && (
            <button
              onClick={onClose}
              className="absolute right-4 top-4 p-1.5 rounded-full hover:bg-slate-100 transition text-slate-400 hover:text-slate-600 cursor-pointer"
            >
              <X className="h-5 w-5" />
            </button>
          )}

          <div className="p-6 md:p-8 flex flex-col items-center">

            {/* ── SELECT STAGE ── */}
            {stage === "SELECT" && (
              <div className="w-full">
                {/* Branding header */}
                <div className="flex flex-col items-center text-center mb-5">
                  <div className="flex items-center gap-2 mb-2">
                    {authMethod === "GOOGLE" ? (
                      <>
                        <svg className="h-6 w-6" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                          <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                          <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                          <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" fill="#FBBC05"/>
                          <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" fill="#EA4335"/>
                        </svg>
                        <span className="text-slate-400 font-bold">Sign in with Google</span>
                      </>
                    ) : (
                      <>
                        <Lock className="h-6 w-6 text-brand-blue" />
                        <span className="text-slate-455 font-bold">{emailMode === "LOGIN" ? "Email Sign-In" : "Email Sign-Up"}</span>
                      </>
                    )}
                  </div>
                  <p className="text-xs text-slate-450 font-bold uppercase tracking-widest mt-1">SINKRONISASI REKAM MEDIS</p>
                  <h3 className="text-xl font-black text-slate-900 mt-0.5 tracking-tight">Kredensial Akses</h3>
                  <div className="mt-1.5 flex items-center gap-1.5 px-3 py-1 bg-slate-50 border border-slate-200 rounded-lg">
                    <GpibLogo size={18} />
                    <span className="text-[10px] text-brand-blue font-bold tracking-wide uppercase">{getRoleTitle()}</span>
                  </div>
                </div>

                {/* Authentication Method Selector Tabs */}
                <div className="flex border-b border-slate-100 mb-5 w-full">
                  <button
                    type="button"
                    onClick={() => {
                      setAuthMethod("GOOGLE");
                      setErrorMsg(null);
                    }}
                    className={`flex-1 pb-2 text-[11px] font-extrabold uppercase tracking-wider border-b-2 text-center transition-all cursor-pointer ${
                      authMethod === "GOOGLE"
                        ? "border-brand-blue text-brand-blue"
                        : "border-transparent text-slate-400 hover:text-slate-600"
                    }`}
                  >
                    Google Account
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAuthMethod("EMAIL");
                      setErrorMsg(null);
                    }}
                    className={`flex-1 pb-2 text-[11px] font-extrabold uppercase tracking-wider border-b-2 text-center transition-all cursor-pointer ${
                      authMethod === "EMAIL"
                        ? "border-brand-blue text-brand-blue"
                        : "border-transparent text-slate-400 hover:text-slate-600"
                    }`}
                  >
                    Email & Sandi
                  </button>
                </div>

                {/* Error message */}
                {errorMsg && (
                  <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 font-semibold leading-relaxed">
                    {errorMsg}
                  </div>
                )}

                {/* ── GOOGLE METHOD ── */}
                {authMethod === "GOOGLE" && (
                  <div className="space-y-4">
                    {/* Primary GIS One-Tap trigger button */}
                    <div className="space-y-3">
                      <button
                        onClick={handleGoogleSignIn}
                        className="w-full flex items-center justify-center gap-3 p-3.5 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 hover:shadow-sm transition-all focus:ring-2 focus:ring-brand-blue/20 cursor-pointer"
                      >
                        <svg className="h-5 w-5" viewBox="0 0 24 24">
                          <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                          <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                          <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" fill="#FBBC05"/>
                          <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" fill="#EA4335"/>
                        </svg>
                        <span className="font-bold text-slate-700 text-sm">Lanjutkan dengan Google</span>
                      </button>

                      {/* GIS fallback rendered button */}
                      <div
                        ref={gisButtonRef}
                        className="w-full flex items-center justify-center min-h-[44px]"
                        title="Alternatif: klik tombol ini jika pop-up diblokir"
                      />
                    </div>
                  </div>
                )}

                {/* ── EMAIL METHOD ── */}
                {authMethod === "EMAIL" && (
                  <form onSubmit={handleEmailAuthSubmit} className="space-y-4 mb-4 text-left font-sans">
                    {emailMode === "REGISTER" && (
                      <div>
                        <label className="text-[10px] font-bold text-slate-400 block mb-1 uppercase tracking-wider">Nama Lengkap</label>
                        <input
                          type="text"
                          value={displayName}
                          onChange={(e) => setDisplayName(e.target.value)}
                          placeholder="Masukkan nama lengkap Anda"
                          className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold focus:border-brand-blue focus:outline-none"
                          required
                        />
                      </div>
                    )}
                    <div>
                      <label className="text-[10px] font-bold text-slate-400 block mb-1 uppercase tracking-wider">Alamat Email</label>
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="contoh@gmail.com"
                        className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold focus:border-brand-blue focus:outline-none"
                        required
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-400 block mb-1 uppercase tracking-wider">Kata Sandi (Password)</label>
                      <input
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="••••••••"
                        className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold focus:border-brand-blue focus:outline-none"
                        required
                      />
                    </div>

                    <button
                      type="submit"
                      className="w-full py-3.5 bg-brand-blue hover:bg-opacity-95 text-white font-bold text-xs uppercase tracking-wider rounded-xl hover:shadow-md transition duration-200 cursor-pointer text-center"
                    >
                      {emailMode === "LOGIN" ? "Masuk ke Akun" : "Daftar Akun Baru"}
                    </button>

                    <div className="text-center mt-2.5">
                      <button
                        type="button"
                        onClick={() => {
                          setEmailMode(emailMode === "LOGIN" ? "REGISTER" : "LOGIN");
                          setErrorMsg(null);
                        }}
                        className="text-xs text-brand-blue hover:underline font-bold"
                      >
                        {emailMode === "LOGIN" ? "Belum punya akun? Daftar sekarang" : "Sudah punya akun? Masuk"}
                      </button>
                    </div>
                  </form>
                )}

                {/* GDPR-style consent */}
                <div className="border-t border-slate-100 pt-4 px-1.5">
                  <label className="flex items-start gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={hasConsented}
                      onChange={(e) => setHasConsented(e.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-blue focus:ring-brand-blue cursor-pointer"
                    />
                    <span className="text-[10px] text-slate-500 leading-relaxed font-semibold">
                      Dengan masuk, saya menyetujui ketaatan rekam medis digital (EMR) dan menyelaraskan
                      integrasi email ke server database aman{" "}
                      <strong className="text-slate-700">GPIB Bukit Zaitun</strong> sesuai Standar Privasi Medis.
                    </span>
                  </label>
                </div>

                <p className="mt-3 text-center text-[10px] text-slate-400 font-medium">
                  {authMethod === "GOOGLE" ? "Menggunakan Google Identity Services (GIS) · Tidak ada password disimpan" : "Koneksi terenkripsi SSL aman · Kata sandi di-hash satu arah"}
                </p>
              </div>
            )}

            {/* ── LOADING STAGE ── */}
            {stage === "LOADING" && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex flex-col items-center py-8 text-center"
              >
                <div className="relative h-16 w-16 mb-6">
                  <div className="absolute inset-0 rounded-full border-4 border-slate-100" />
                  <div className="absolute inset-0 rounded-full border-4 border-t-brand-blue border-r-brand-green border-b-amber-400 border-l-rose-500 animate-spin" />
                  <Lock className="absolute inset-0 m-auto h-5 w-5 text-slate-400" />
                </div>
                <span className="text-[10px] uppercase font-bold text-brand-blue tracking-widest block bg-blue-50 border border-blue-100 px-2 rounded-sm mb-2">
                  Verifikasi Otentikasi
                </span>
                <h4 className="text-lg font-bold text-slate-800 tracking-tight">Memproses Autentikasi...</h4>
                <p className="text-xs text-slate-400 max-w-xs mt-1.5 leading-relaxed font-semibold">
                  Mendapatkan otorisasi dan menyinkronkan profil rekam medis digital ke Supabase.
                </p>
              </motion.div>
            )}

            {/* ── SUCCESS STAGE ── */}
            {stage === "SUCCESS" && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex flex-col items-center py-8 text-center"
              >
                <div className="h-16 w-16 rounded-full bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-500 mb-5 shadow-inner">
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", stiffness: 300, delay: 0.1 }}
                  >
                    <Check className="h-9 w-9 stroke-[3]" />
                  </motion.div>
                </div>
                <span className="text-[10px] uppercase font-bold text-emerald-600 tracking-widest block bg-emerald-50 border border-emerald-100 px-2 rounded-sm mb-2">
                  AUTENTIKASI BERHASIL
                </span>
                <h4 className="text-xl font-extrabold text-slate-900 tracking-tight">Otentikasi Sukses</h4>
                <p className="text-xs text-slate-500 max-w-xs mt-1 leading-relaxed font-semibold">
                  Sesi aman telah disinkronisasikan. Mengalihkan ke wilayah pelayanan Anda...
                </p>
              </motion.div>
            )}

          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
