/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export enum Role {
  PATIENT = "PATIENT",
  DOCTOR = "DOCTOR",
  ADMIN = "ADMIN"
}

export enum AppointmentUrgency {
  ROUTINE = "ROUTINE",
  SOON = "SOON",
  URGENT = "URGENT"
}

export enum AppointmentStatus {
  PENDING_TRIAGE = "PENDING_TRIAGE",
  CONFIRMED = "CONFIRMED",
  COMPLETED = "COMPLETED",
  CANCELLED = "CANCELLED"
}

export function formatAppointmentStatus(status: AppointmentStatus | string): string {
  switch (status) {
    case AppointmentStatus.PENDING_TRIAGE:
      return "Menunggu Triase";
    case AppointmentStatus.CONFIRMED:
      return "Terkonfirmasi";
    case AppointmentStatus.COMPLETED:
      return "Selesai";
    case AppointmentStatus.CANCELLED:
      return "Dibatalkan";
    default:
      return typeof status === "string" ? status : "";
  }
}

export function formatAppointmentUrgency(urgency: AppointmentUrgency | string): string {
  switch (urgency) {
    case AppointmentUrgency.ROUTINE:
      return "Rutin";
    case AppointmentUrgency.SOON:
      return "Segera";
    case AppointmentUrgency.URGENT:
      return "Gawat Darurat";
    default:
      return typeof urgency === "string" ? urgency : "";
  }
}


export interface Patient {
  id: string;
  name: string;
  email: string;
  phone: string;
  birthDate: string;
  preferredLanguage: string;
  faithSupportRequested: boolean;
  faithNotes?: string;
  insuranceNotes: string; // Typically "No Insurance - Fully Free Clinic"
  medicalHistory: string[];
  allergies: string[];
}

export interface Doctor {
  id: string;
  name: string;
  specialty: string;
  icon?: string;
}

export interface TriageMessage {
  id: string;
  sender: "patient" | "ai";
  text: string;
  timestamp: string;
}

export interface Appointment {
  id: string;
  patientId: string;
  patientName: string;
  date: string;
  timeSlot: string;
  reason: string;
  status: AppointmentStatus;
  urgency: AppointmentUrgency;
  triageSummary: string;
  triageChatHistory: TriageMessage[];
  triageCompleted: boolean;
  notes?: string; // Doctor's consultation note
  suggestedFollowUp?: {
    timeframe: string;
    reason: string;
    urgency: AppointmentUrgency;
    approved: boolean;
  };
  prescriptions?: Prescription[];
  updatedAt: string;
}

export interface Prescription {
  id: string;
  patientId: string;
  datePrescribed: string;
  medicationName: string;
  dosage: string;
  frequency: string;
  instructions: string;
  doctorName: string;
  refillsLeft: number;
}

export interface AuditLog {
  id: string;
  timestamp: string;
  actorEmail: string;
  actorRole: Role;
  action: string;
  details: string;
}
