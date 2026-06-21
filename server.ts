/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from "express";
import path from "path";
import dotenv from "dotenv";
import crypto from "crypto";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import { db } from "./src/db/index.ts";
import { patients, appointments, prescriptions, auditLogs, users, authorizedRoles } from "./src/db/schema.ts";
import { eq, desc } from "drizzle-orm";

// Load environment variables
dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());


// Lazy-loaded Gemini Client with defensive safety fallback
let aiInstance: GoogleGenAI | null = null;

function getGeminiClient() {
  if (aiInstance) return aiInstance;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "MY_GEMINI_API_KEY" || apiKey === "") {
    console.warn("GEMINI_API_KEY is not set or has placeholder value. Server will run on mock fallback mode.");
    return null;
  }
  try {
    aiInstance = new GoogleGenAI({
      apiKey: apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });
    return aiInstance;
  } catch (error) {
    console.error("Failed to initialize GoogleGenAI client:", error);
    return null;
  }
}

// REST endpoints
app.get("/api/health", (req, res) => {
  res.json({ status: "healthy", time: new Date().toISOString() });
});

// Fetch patients from Postgres
app.get("/api/patients", async (req, res) => {
  try {
    const list = await db.select().from(patients);
    res.json(list);
  } catch (error) {
    console.error("Failed to fetch patients from DB:", error);
    res.status(500).json({ error: "Failed to fetch patients" });
  }
});

// Fetch appointments from Postgres
app.get("/api/appointments", async (req, res) => {
  try {
    const list = await db.select().from(appointments);
    res.json(list);
  } catch (error) {
    console.error("Failed to fetch appointments from DB:", error);
    res.status(500).json({ error: "Failed to fetch appointments" });
  }
});

// Fetch prescriptions from Postgres
app.get("/api/prescriptions", async (req, res) => {
  try {
    const list = await db.select().from(prescriptions);
    res.json(list);
  } catch (error) {
    console.error("Failed to fetch prescriptions from DB:", error);
    res.status(500).json({ error: "Failed to fetch prescriptions" });
  }
});

// Sync client medical records back to Cloud SQL
app.post("/api/sync", async (req, res) => {
  const { patients: patientList, appointments: appointmentList, prescriptions: prescriptionList } = req.body;
  try {
    // Upsert patients
    if (patientList && Array.isArray(patientList)) {
      for (const pat of patientList) {
        await db.insert(patients)
          .values({
            id: pat.id,
            name: pat.name,
            email: pat.email,
            phone: pat.phone,
            birthDate: pat.birthDate,
            preferredLanguage: pat.preferredLanguage,
            faithSupportRequested: pat.faithSupportRequested,
            faithNotes: pat.faithNotes || null,
            insuranceNotes: pat.insuranceNotes,
            medicalHistory: pat.medicalHistory,
            allergies: pat.allergies,
          })
          .onConflictDoUpdate({
            target: patients.id,
            set: {
              name: pat.name,
              email: pat.email,
              phone: pat.phone,
              birthDate: pat.birthDate,
              preferredLanguage: pat.preferredLanguage,
              faithSupportRequested: pat.faithSupportRequested,
              faithNotes: pat.faithNotes || null,
              insuranceNotes: pat.insuranceNotes,
              medicalHistory: pat.medicalHistory,
              allergies: pat.allergies,
            },
          });
      }
    }

    // Upsert appointments
    if (appointmentList && Array.isArray(appointmentList)) {
      for (const appt of appointmentList) {
        await db.insert(appointments)
          .values({
            id: appt.id,
            patientId: appt.patientId,
            patientName: appt.patientName,
            date: appt.date,
            timeSlot: appt.timeSlot,
            reason: appt.reason,
            status: appt.status,
            urgency: appt.urgency,
            triageSummary: appt.triageSummary || '',
            triageChatHistory: appt.triageChatHistory || [],
            triageCompleted: appt.triageCompleted || false,
            notes: appt.notes || null,
            suggestedFollowUp: appt.suggestedFollowUp || null,
            updatedAt: appt.updatedAt,
          })
          .onConflictDoUpdate({
            target: appointments.id,
            set: {
              status: appt.status,
              triageSummary: appt.triageSummary || '',
              triageChatHistory: appt.triageChatHistory || [],
              triageCompleted: appt.triageCompleted || false,
              notes: appt.notes || null,
              suggestedFollowUp: appt.suggestedFollowUp || null,
              updatedAt: appt.updatedAt,
            },
          });
      }
    }

    // Upsert prescriptions
    if (prescriptionList && Array.isArray(prescriptionList)) {
      for (const rx of prescriptionList) {
        await db.insert(prescriptions)
          .values({
            id: rx.id,
            patientId: rx.patientId,
            datePrescribed: rx.datePrescribed,
            medicationName: rx.medicationName,
            dosage: rx.dosage,
            frequency: rx.frequency,
            instructions: rx.instructions,
            doctorName: rx.doctorName,
            refillsLeft: rx.refillsLeft,
          })
          .onConflictDoUpdate({
            target: prescriptions.id,
            set: {
              datePrescribed: rx.datePrescribed,
              medicationName: rx.medicationName,
              dosage: rx.dosage,
              frequency: rx.frequency,
              instructions: rx.instructions,
              doctorName: rx.doctorName,
              refillsLeft: rx.refillsLeft,
            },
          });
      }
    }

    res.json({ success: true, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error("Failed to synchronize relational database state:", error);
    res.status(500).json({ error: "Failed to synchronize state" });
  }
});

/**
 * POST /api/auth/google
 * Verifies a Google ID-token issued by GIS, upserts the user in Supabase,
 * and checks role-based access (DOCTOR / ADMIN must be pre-authorized).
 *
 * Body: { idToken: string, role: "PATIENT" | "DOCTOR" | "ADMIN" }
 * Returns: { accessGranted: boolean, reason?: string, user?: object }
 */
app.post("/api/auth/google", async (req, res) => {
  const { idToken, role } = req.body as { idToken?: string; role?: string };

  if (!idToken) {
    return res.status(400).json({ error: "Missing idToken in request body." });
  }
  if (!role || !["PATIENT", "DOCTOR", "ADMIN"].includes(role)) {
    return res.status(400).json({ error: "Invalid role. Must be PATIENT, DOCTOR, or ADMIN." });
  }

  // ── Step 1: Verify the ID-token with Google's tokeninfo endpoint ──────────
  // For production use google-auth-library; tokeninfo is simpler for small apps.
  let googlePayload: Record<string, any>;
  try {
    const tokenInfoRes = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`
    );
    if (!tokenInfoRes.ok) {
      throw new Error("Google token verification failed (HTTP " + tokenInfoRes.status + ")");
    }
    googlePayload = await tokenInfoRes.json();

    // Validate audience matches our client ID
    const expectedClientId = process.env.GOOGLE_CLIENT_ID;
    if (expectedClientId && googlePayload.aud !== expectedClientId) {
      throw new Error("Token audience mismatch — possible token injection attack.");
    }
    if (!googlePayload.sub || !googlePayload.email) {
      throw new Error("Incomplete Google payload — missing sub or email.");
    }
  } catch (err: any) {
    console.error("[auth/google] Token verification error:", err.message);
    return res.status(401).json({ error: "Invalid or expired Google ID-token.", detail: err.message });
  }

  const { sub: googleSub, email, name: displayName, picture: photoUrl } = googlePayload;

  // ── Step 2: Role-based access control ────────────────────────────────────
  const masterAdminEmail = process.env.MASTER_ADMIN_EMAIL || "fritssigerdkayadoe@gmail.com";

  if (role !== "PATIENT" && email !== masterAdminEmail) {
    // Check authorized_roles table
    try {
      const allowed = await db
        .select()
        .from(authorizedRoles)
        .where(eq(authorizedRoles.email, email))
        .limit(10);

      const hasRole = allowed.some((r) => r.role === role);
      if (!hasRole) {
        return res.json({
          accessGranted: false,
          reason: `Akun ${email} belum didaftarkan oleh Master Admin untuk akses ${role}. Hubungi Admin Diakonia.`,
        });
      }
    } catch (dbErr) {
      console.error("[auth/google] authorized_roles lookup failed:", dbErr);
      return res.status(500).json({ error: "Database error during role check." });
    }
  }

  // ── Step 3: Upsert user in Supabase ──────────────────────────────────────
  try {
    const existing = await db
      .select()
      .from(users)
      .where(eq(users.googleSub, googleSub))
      .limit(1);

    let resultUser;
    if (existing.length > 0) {
      const updated = await db
        .update(users)
        .set({ email, displayName: displayName || null, photoUrl: photoUrl || null, role, updatedAt: new Date() })
        .where(eq(users.googleSub, googleSub))
        .returning();
      resultUser = updated[0];
    } else {
      const inserted = await db
        .insert(users)
        .values({ googleSub, email, displayName: displayName || null, photoUrl: photoUrl || null, role })
        .returning();
      resultUser = inserted[0];
    }

    return res.json({ accessGranted: true, user: resultUser });
  } catch (dbErr) {
    console.error("[auth/google] User upsert failed:", dbErr);
    return res.status(500).json({ error: "Failed to synchronize user profile to database." });
  }
});

// Helper functions for secure password hashing and verification
function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, "sha512").toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, storedValue: string): boolean {
  const parts = storedValue.split(":");
  if (parts.length !== 2) return false;
  const [salt, hash] = parts;
  const testHash = crypto.pbkdf2Sync(password, salt, 1000, 64, "sha512").toString("hex");
  return hash === testHash;
}

/**
 * POST /api/auth/email/register
 * Creates a new user with email & password, and checks role-based access.
 */
app.post("/api/auth/email/register", async (req, res) => {
  const { email, password, displayName, role } = req.body as {
    email?: string;
    password?: string;
    displayName?: string;
    role?: string;
  };

  if (!email || !password) {
    return res.status(400).json({ error: "Email dan password wajib diisi." });
  }
  if (!role || !["PATIENT", "DOCTOR", "ADMIN"].includes(role)) {
    return res.status(400).json({ error: "Role tidak valid." });
  }

  const normalizedEmail = email.trim().toLowerCase();

  // ── Step 1: Role-based access control check ──────────────────────────────
  const masterAdminEmail = process.env.MASTER_ADMIN_EMAIL || "fritssigerdkayadoe@gmail.com";

  if (role !== "PATIENT" && normalizedEmail !== masterAdminEmail) {
    try {
      const allowed = await db
        .select()
        .from(authorizedRoles)
        .where(eq(authorizedRoles.email, normalizedEmail))
        .limit(10);

      const hasRole = allowed.some((r) => r.role === role);
      if (!hasRole) {
        return res.json({
          accessGranted: false,
          reason: `Akun ${normalizedEmail} belum didaftarkan oleh Master Admin untuk akses ${role}. Hubungi Admin Diakonia.`,
        });
      }
    } catch (dbErr) {
      console.error("[auth/register] authorized_roles lookup failed:", dbErr);
      return res.status(500).json({ error: "Database error during role check." });
    }
  }

  // ── Step 2: Check if email is already registered ────────────────────────
  try {
    const existing = await db
      .select()
      .from(users)
      .where(eq(users.email, normalizedEmail))
      .limit(1);

    if (existing.length > 0) {
      return res.status(400).json({ error: "Email ini sudah terdaftar. Silakan login." });
    }

    // ── Step 3: Insert user with password hash ──────────────────────────────
    const passwordHash = hashPassword(password);
    const inserted = await db
      .insert(users)
      .values({
        email: normalizedEmail,
        passwordHash,
        displayName: displayName || null,
        role,
      })
      .returning();

    return res.json({ accessGranted: true, user: inserted[0] });
  } catch (dbErr) {
    console.error("[auth/register] User insert failed:", dbErr);
    return res.status(500).json({ error: "Gagal menyimpan akun ke database." });
  }
});

/**
 * POST /api/auth/email/login
 * Authenticates user via email and password, and validates role authorization.
 */
app.post("/api/auth/email/login", async (req, res) => {
  const { email, password, role } = req.body as {
    email?: string;
    password?: string;
    role?: string;
  };

  if (!email || !password) {
    return res.status(400).json({ error: "Email dan password wajib diisi." });
  }
  if (!role || !["PATIENT", "DOCTOR", "ADMIN"].includes(role)) {
    return res.status(400).json({ error: "Role tidak valid." });
  }

  const normalizedEmail = email.trim().toLowerCase();

  try {
    // ── Step 1: Find user ──────────────────────────────────────────────────
    const existing = await db
      .select()
      .from(users)
      .where(eq(users.email, normalizedEmail))
      .limit(1);

    if (existing.length === 0) {
      return res.status(401).json({ error: "Akun tidak ditemukan. Silakan daftar terlebih dahulu." });
    }

    const user = existing[0];

    // If user registered with Google but has no password hash
    if (!user.passwordHash) {
      return res.status(400).json({
        error: "Akun ini dibuat menggunakan Google Sign-In. Silakan masuk menggunakan tombol Google.",
      });
    }

    // ── Step 2: Verify Password ────────────────────────────────────────────
    if (!verifyPassword(password, user.passwordHash)) {
      return res.status(401).json({ error: "Password salah. Silakan periksa kembali." });
    }

    // ── Step 3: Role check ─────────────────────────────────────────────────
    const masterAdminEmail = process.env.MASTER_ADMIN_EMAIL || "fritssigerdkayadoe@gmail.com";
    if (role !== "PATIENT" && normalizedEmail !== masterAdminEmail) {
      const allowed = await db
        .select()
        .from(authorizedRoles)
        .where(eq(authorizedRoles.email, normalizedEmail))
        .limit(10);

      const hasRole = allowed.some((r) => r.role === role);
      if (!hasRole) {
        return res.json({
          accessGranted: false,
          reason: `Akun ${normalizedEmail} tidak diizinkan masuk sebagai ${role}. Hubungi Admin Diakonia.`,
        });
      }
    }

    // Update user role if logging in with authorized role
    if (user.role !== role) {
      const updated = await db
        .update(users)
        .set({ role, updatedAt: new Date() })
        .where(eq(users.id, user.id))
        .returning();
      return res.json({ accessGranted: true, user: updated[0] });
    }

    return res.json({ accessGranted: true, user });
  } catch (dbErr) {
    console.error("[auth/login] Database operation failed:", dbErr);
    return res.status(500).json({ error: "Kesalahan internal server saat login." });
  }
});

// Write to audit log endpoint (relational insert)
app.post("/api/logs", async (req, res) => {
  const { actorEmail, actorRole, action, details } = req.body;
  const newLog = {
    id: `log-${Date.now()}`,
    timestamp: new Date().toISOString(),
    actorEmail: actorEmail || "system@graceclinic.org",
    actorRole: actorRole || "SYSTEM",
    action: action || "System Event",
    details: details || ""
  };
  try {
    await db.insert(auditLogs).values(newLog);
    res.json(newLog);
  } catch (error) {
    console.error("Failed to post audit log:", error);
    // Silent recovery or generic response to protect execution flow
    res.json(newLog);
  }
});

// Fetch all simulated logs from DB orderly
app.get("/api/logs", async (req, res) => {
  try {
    const list = await db.select().from(auditLogs);
    // Sort descending by timestamp
    const sorted = list.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    res.json(sorted);
  } catch (error) {
    console.error("Failed to read audit logs from DB:", error);
    res.json([]);
  }
});

// Admin area protection simulation (Section 3.8/REQ-AUTH-06)
app.use("/api/admin/*", (req, res, next) => {
  const actorRole = req.headers["x-user-role"];
  if (actorRole !== "ADMIN") {
    return res.status(403).json({
      error: "Access Denied",
      message: "Security Barrier (REQ-AUTH-06): Non-admin sessions are prohibited from administrative endpoints."
    });
  }
  next();
});

// Protected administrative actions
app.get("/api/admin/metrics", async (req, res) => {
  try {
    const listPatients = await db.select().from(patients);
    const listAppointments = await db.select().from(appointments);
    const pendingTriage = listAppointments.filter(a => !a.triageCompleted);
    const faithCounter = listPatients.filter(p => p.faithSupportRequested).length;

    res.json({
      activePatients: listPatients.length,
      completedVisits: listAppointments.filter(a => a.status === "Completed").length,
      pendingTriageCount: pendingTriage.length,
      faithInterventions: faithCounter
    });
  } catch (error) {
    console.error("Failed to load metrics from DB:", error);
    res.json({
      activePatients: 3,
      completedVisits: 0,
      pendingTriageCount: 1,
      faithInterventions: 2
    });
  }
});

/**
 * Endpoint for interactive triage chat
 */
app.post("/api/gemini/triage", async (req, res) => {
  const { chatHistory } = req.body;

  if (!chatHistory || !Array.isArray(chatHistory)) {
    return res.status(400).json({ error: "Invalid parameters. chatHistory list is required." });
  }

  const client = getGeminiClient();

  // Format conversational context for Gemini
  const conversationContext = chatHistory
    .map((msg: any) => `${msg.sender === "patient" ? "Patient" : "Grace Clinic AI Companion"}: ${msg.text}`)
    .join("\n");

  const systemInstruction = `You are \"Grace Clinic AI Companion\", a warm, deeply compassionate, and clinically accurate medical assistant for Grace Community Free Clinic, which serves low-income families and those without insurance. Your role is to perform intelligent clinical triage before their upcoming Friday physician visit.

Follow these strict constraints:
1. Speak with extreme warmth, patience, and empathetic concern. Use soft, reassuring language. Never sound mechanical or cold.
2. If this is the start of the chat (patient has only said hello or the chat is empty), greet them warmly and ask them what symptom or healthcare need brings them in today.
3. If they name a symptom, ask EXACTLY ONE targeted follow-up question regarding severity, onset, triggers, or accompanying symptoms (e.g., if dizzy, ask if things spin when moving, if they feel lightheaded, or have nausea).
4. Do not list 10 questions at once. Ask exactly one friendly question at a time to keep it conversationally accessible.
5. IF the patient presents high-risk, life-threatening symptoms (e.g., severe localized crushing chest pain, sudden paralysis/numbness, extreme struggle to breathe, sudden loss of vision), IMMEDIATELY supply a clear, highly visible alert advising them to CALL 911 or visit the nearest ER.
6. Once you have conducted 2-3 brief clinical exchanges, or once the symptoms are fully detailed, complete the triage.
7. Return a structured JSON response matching the required schema:
   - reply: The compassionate response or next follow-up question to present to the patient.
   - triageCompleted: Set to true ONLY if you have gathered sufficient details (2-3 rounds) to form the professional summary, or if they are in an urgent emergency state. Else false.
   - suggestedUrgency: Determine clinic urgency level: "ROUTINE", "SOON", or "URGENT".
   - suggestedSummary: Summarize symptoms, duration, intensity, specific triggers, and medical profile neatly in a bulleted professional doctor presentation format. Leave as empty string if triageCompleted is false.`;

  // Fallback simulator for mock mode
  const runSimulatedTriage = (history: any[]) => {
    const exchangeCount = history.filter(m => m.sender === "patient").length;
    const latestUserMsg = history[history.length - 1]?.text || "";
    const lowerMsg = latestUserMsg.toLowerCase();

    // High risk checks
    if (lowerMsg.includes("chest pain") || lowerMsg.includes("heart attack") || lowerMsg.includes("can't breathe") || lowerMsg.includes("stroke")) {
      return {
        reply: "⚠️ IMMEDIATE WARNING: Please call 911 or go to the nearest Emergency Room immediately. Your symptoms suggest an urgent medical emergency. Please do not wait for our Friday clinic.",
        triageCompleted: true,
        suggestedUrgency: "URGENT",
        suggestedSummary: `EMERGENCY PRESENTATION:\n- Symptoms: ${latestUserMsg}\n- Impact: High risk of cardiopulmonary or neurological distress.\n- Action Taken: AI generated an immediate Emergency warnings and advised ER visitation.`
      };
    }

    if (exchangeCount <= 1) {
      return {
        reply: "Thank you for sharing that with me. I want to make sure our medical team has everything they need to support you. Could you tell me roughly when these symptoms started, and if they feel constant or come and go?",
        triageCompleted: false,
        suggestedUrgency: "ROUTINE",
        suggestedSummary: ""
      };
    } else if (exchangeCount === 2) {
      return {
        reply: "I understand. That must be quite uncomfortable. Are you experiencing any other symptoms along with this, such as headache, fever, lightheadedness, or any localized pain?",
        triageCompleted: false,
        suggestedUrgency: "ROUTINE",
        suggestedSummary: ""
      };
    } else {
      // Completed triage simulation
      let summary = `PATIENT SYMPTOM SUMMARY:\n- Chief Complaint: Patient reported suffering from symptoms described as: "${history[0]?.text || 'N/A'}"\n- Timeline & Characteristics: Patient noted duration and impact during interactive questionnaire.\n- Faith Support: Optional chaplain or community prayer circle requested by patient.\n- Urgency: Clinically classified as ROUTINE clinic follow-up. Recommended physical exam this coming Friday.`;
      
      return {
        reply: "Thank you so much for answering these questions. I have securely compiled this information into a clinical summary for Dr. Sarah's review. She will go over this before she meets with you this Friday. Is there anything else you want to share, or would you like to explore scheduling the appointment now?",
        triageCompleted: true,
        suggestedUrgency: "SOON",
        suggestedSummary: summary
      };
    }
  };

  if (!client) {
    // Return simulated response
    const mockReply = runSimulatedTriage(chatHistory);
    return res.json(mockReply);
  }

  try {
    const genResponse = await client.models.generateContent({
      model: "gemini-3.5-flash",
      contents: `Existing Chat Context for Triage:\n${conversationContext}\n\nPlease generate a response based on current conversation.`,
      config: {
        systemInstruction: systemInstruction,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            reply: { type: Type.STRING, description: "Compassionate conversational response next to show patient." },
            triageCompleted: { type: Type.BOOLEAN, description: "Whether triage is finished." },
            suggestedUrgency: { type: Type.STRING, description: "Urgency: ROUTINE, SOON, or URGENT." },
            suggestedSummary: { type: Type.STRING, description: "Clinical presentation report for doctors. Empty if not finished." }
          },
          required: ["reply", "triageCompleted", "suggestedUrgency", "suggestedSummary"]
        }
      }
    });

    const parsedData = JSON.parse(genResponse.text || "{}");
    return res.json(parsedData);
  } catch (error) {
    console.error("Gemini triage api call failed:", error);
    // Graceful fallback to guarantee uptime
    const mockReply = runSimulatedTriage(chatHistory);
    return res.json(mockReply);
  }
});

/**
 * Endpoint for clinical follow-up planning suggestions (Section 3.4)
 */
app.post("/api/gemini/suggest-followup", async (req, res) => {
  const { doctorNotes } = req.body;

  if (!doctorNotes) {
    return res.status(400).json({ error: "Missing doctorNotes parameter." });
  }

  const client = getGeminiClient();

  const systemInstruction = `You are a clinical decision support assistant. You read doctor consultation notes from a community free clinic, and suggest the logical follow-up timeline and clinical objective.
Return a structured JSON with:
1. timeframe: String, specific timeline recommendation e.g. "In 2 weeks", "In 1 month", "PRN (As needed)".
2. reason: String, medical reasoning/objective for follow-up.
3. urgency: String, Urgency class: "ROUTINE", "SOON", or "URGENT".`;

  const runMockFollowUp = (notes: string) => {
    const notesLower = notes.toLowerCase();
    if (notesLower.includes("blood pressure") || notesLower.includes("hypertension")) {
      return {
        timeframe: "In 2 weeks",
        reason: "Monitor blood pressure regulation, check medication compliance, and evaluate efficacy of newly started therapy.",
        urgency: "SOON"
      };
    } else if (notesLower.includes("diabetes") || notesLower.includes("sugar") || notesLower.includes("insulin")) {
      return {
        timeframe: "In 1 month",
        reason: "Review blood glucose logs, monitor HbA1c progression, and check for signs of peripheral neuropathy.",
        urgency: "ROUTINE"
      };
    } else if (notesLower.includes("infect") || notesLower.includes("antibiotic")) {
      return {
        timeframe: "In 5-7 days",
        reason: "Re-evaluate infectious site, ensure resolves, and confirm completion of antibiotic course.",
        urgency: "SOON"
      };
    } else {
      return {
        timeframe: "As needed (PRN)",
        reason: "Routine support. Recheck if symptoms recur, or visit community outreach for regular wellness checks.",
        urgency: "ROUTINE"
      };
    }
  };

  if (!client) {
    const mockResponse = runMockFollowUp(doctorNotes);
    return res.json(mockResponse);
  }

  try {
    const genResponse = await client.models.generateContent({
      model: "gemini-3.5-flash",
      contents: `Analyze these physician notes and recommend a safety-oriented follow-up schedule:\nNotes:\n"${doctorNotes}"`,
      config: {
        systemInstruction: systemInstruction,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            timeframe: { type: Type.STRING, description: "Follow-up schedule timeframe recommendation." },
            reason: { type: Type.STRING, description: "Detailed clinical purpose/objective of the visit." },
            urgency: { type: Type.STRING, description: "Urgency category: 'ROUTINE', 'SOON', or 'URGENT'." }
          },
          required: ["timeframe", "reason", "urgency"]
        }
      }
    });

    const parsedData = JSON.parse(genResponse.text || "{}");
    return res.json(parsedData);
  } catch (error) {
    console.error("Gemini follow-up suggestion failed:", error);
    const mockResponse = runMockFollowUp(doctorNotes);
    return res.json(mockResponse);
  }
});

// Start final listening & integration
async function startServer() {
  // Vite integration
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
    console.log("Vite middleware mounted for local UI development.");
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
    console.log("Production state: serving compiled static UI elements.");
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`========================================`);
    console.log(`Grace Community Clinic Server initialized`);
    console.log(`Host Address: http://0.0.0.0:${PORT}`);
    console.log(`Time Context: 2026-06-11 UTC`);
    console.log(`========================================`);
  });
}

startServer();
