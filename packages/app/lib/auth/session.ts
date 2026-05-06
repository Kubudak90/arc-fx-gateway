import { getIronSession, type SessionOptions } from "iron-session";
import { cookies } from "next/headers";

export interface SessionData {
  merchantAddress?: string;
  // apiKey removed (Audit L9, 2026-05-06): storing a live API credential in
  // the server-side session cookie is unnecessary weight. The key is returned
  // in the response body at bootstrap / rotation (single-use reveal); the
  // caller is responsible for persisting it client-side if needed.
}

export const sessionOptions: SessionOptions = {
  password: process.env.IRON_SESSION_PASSWORD!,
  cookieName: "arcfx_session",
  cookieOptions: {
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    httpOnly: true,
  },
};

export async function getSession() {
  return getIronSession<SessionData>(await cookies(), sessionOptions);
}
