import dayjs from "dayjs";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { evaluateAttendanceGuard, extractRequestIp } from "../services/attendanceGuard.js";

const router = Router();

const clockInBodySchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
  wfhCode: z.string().length(6).optional()
});

const clockOutBodySchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
  wfhCode: z.string().length(6).optional(),
  workUpdate: z.string().trim().min(5, "Work update must be at least 5 characters.")
});

function getDayBounds() {
  const start = dayjs().startOf("day").toDate();
  const end = dayjs().endOf("day").toDate();
  return { start, end };
}

router.get("/today", requireAuth, async (req, res) => {
  const { start } = getDayBounds();

  const attendance = await prisma.attendance.findUnique({
    where: {
      userId_date: {
        userId: req.user!.id,
        date: start
      }
    }
  });

  return res.json(attendance);
});

router.post("/clock-in", requireAuth, async (req, res) => {
  const parsed = clockInBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid payload." });
  }

  const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
  if (!user) return res.status(404).json({ message: "User not found." });

  const requestIp = extractRequestIp(req.headers["x-forwarded-for"] as string | undefined, req.socket.remoteAddress);
  const guard = await evaluateAttendanceGuard({
    userId: user.id,
    userWfhEnabled: user.wfhEnabled,
    userHomeLatitude: user.homeLatitude,
    userHomeLongitude: user.homeLongitude,
    latitude: parsed.data.latitude,
    longitude: parsed.data.longitude,
    requestIp,
    wfhCode: parsed.data.wfhCode
  });

  if (!guard.allowed) {
    return res.status(403).json({ message: guard.message });
  }

  const { start } = getDayBounds();

  const existing = await prisma.attendance.findUnique({
    where: {
      userId_date: {
        userId: user.id,
        date: start
      }
    }
  });

  if (existing?.clockInAt) {
    return res.status(400).json({ message: "Already clocked in today." });
  }

  const attendance = await prisma.attendance.upsert({
    where: {
      userId_date: {
        userId: user.id,
        date: start
      }
    },
    update: {
      clockInAt: new Date(),
      clockInLat: parsed.data.latitude,
      clockInLng: parsed.data.longitude,
      clockInIp: requestIp,
      clockInMode: guard.mode
    },
    create: {
      userId: user.id,
      date: start,
      clockInAt: new Date(),
      clockInLat: parsed.data.latitude,
      clockInLng: parsed.data.longitude,
      clockInIp: requestIp,
      clockInMode: guard.mode
    }
  });

  return res.json(attendance);
});

router.post("/clock-out", requireAuth, async (req, res) => {
  const parsed = clockOutBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: parsed.error.issues[0]?.message || "Invalid payload." });
  }

  const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
  if (!user) return res.status(404).json({ message: "User not found." });

  const { start } = getDayBounds();
  const attendance = await prisma.attendance.findUnique({
    where: {
      userId_date: {
        userId: user.id,
        date: start
      }
    }
  });

  if (!attendance?.clockInAt) {
    return res.status(400).json({ message: "Clock in first." });
  }

  if (attendance.clockOutAt) {
    return res.status(400).json({ message: "Already clocked out today." });
  }

  const clockOutAt = new Date();
  const totalMinutes = Math.max(0, Math.round((clockOutAt.getTime() - attendance.clockInAt.getTime()) / 60000));

  const requestIp = extractRequestIp(req.headers["x-forwarded-for"] as string | undefined, req.socket.remoteAddress);

  const updated = await prisma.attendance.update({
    where: { id: attendance.id },
    data: {
      clockOutAt,
      workUpdate: parsed.data.workUpdate,
      clockOutLat: parsed.data.latitude,
      clockOutLng: parsed.data.longitude,
      clockOutIp: requestIp,
      clockOutMode: attendance.clockInMode,
      totalMinutes
    }
  });

  return res.json(updated);
});

export default router;
