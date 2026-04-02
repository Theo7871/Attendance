import bcrypt from "bcryptjs";
import { WorkMode } from "@prisma/client";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { distanceMeters } from "../utils/geo.js";

type GuardInput = {
  userId: string;
  userWfhEnabled: boolean;
  userHomeLatitude: number | null;
  userHomeLongitude: number | null;
  latitude: number;
  longitude: number;
  requestIp: string;
  wfhCode?: string;
};

type GuardResult = {
  allowed: boolean;
  mode?: WorkMode;
  message?: string;
};

function cleanIp(rawIp: string) {
  if (rawIp === "::1") return "127.0.0.1";
  if (rawIp.startsWith("::ffff:")) return rawIp.replace("::ffff:", "");
  return rawIp;
}

export function extractRequestIp(forwardedHeader: string | undefined, remoteAddress: string | undefined): string {
  const fromForwarded = forwardedHeader?.split(",")[0]?.trim();
  return cleanIp(fromForwarded || remoteAddress || "");
}

async function getActiveDailyCode() {
  const now = new Date();
  return prisma.dailyWfhCode.findFirst({
    where: {
      validFrom: { lte: now },
      expiresAt: { gt: now },
      isRevoked: false
    },
    orderBy: { createdAt: "desc" }
  });
}

async function validateWfhCode(userId: string, rawCode?: string): Promise<{ ok: boolean; message?: string }> {
  if (!rawCode) return { ok: false, message: "WFH code is required outside office mode." };

  const dailyCode = await getActiveDailyCode();
  if (!dailyCode) return { ok: false, message: "No active WFH code available." };

  const codeMatches = await bcrypt.compare(rawCode, dailyCode.codeHash);
  if (!codeMatches) return { ok: false, message: "Invalid WFH code." };

  await prisma.wfhCodeRedemption.upsert({
    where: {
      userId_dailyCodeId: {
        userId,
        dailyCodeId: dailyCode.id
      }
    },
    update: {},
    create: {
      userId,
      dailyCodeId: dailyCode.id
    }
  });

  return { ok: true };
}

export async function evaluateAttendanceGuard(input: GuardInput): Promise<GuardResult> {
  const officeDistance = distanceMeters(
    input.latitude,
    input.longitude,
    config.officeLatitude,
    config.officeLongitude
  );

  const isLocalRequest = input.requestIp === "127.0.0.1";
  const officeIpMatches =
    input.requestIp === config.officePublicIp ||
    (process.env.NODE_ENV !== "production" && isLocalRequest);

  const officeMode =
    officeIpMatches &&
    officeDistance <= config.officeRadiusMeters;

  if (officeMode) {
    return { allowed: true, mode: WorkMode.OFFICE };
  }

  if (!input.userWfhEnabled) {
    return {
      allowed: false,
      message: "WFH is disabled for your account. Please clock in from office mode."
    };
  }

  const wfhCodeValidation = await validateWfhCode(input.userId, input.wfhCode);
  if (!wfhCodeValidation.ok) {
    return { allowed: false, message: wfhCodeValidation.message };
  }

  return { allowed: true, mode: WorkMode.WFH };
}
