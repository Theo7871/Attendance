import { Router } from "express";
import bcrypt from "bcryptjs";
import dayjs from "dayjs";
import { stringify } from "csv-stringify/sync";
import { prisma } from "../db.js";
import { config } from "../config.js";
import { requireAdmin, requireAuth } from "../middleware/auth.js";

const router = Router();

function generateSixDigitCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

router.post("/wfh-code/generate", requireAuth, requireAdmin, async (req, res) => {
  const plainCode = generateSixDigitCode();
  const codeHash = await bcrypt.hash(plainCode, 10);

  const validFrom = new Date();
  const expiresAt = dayjs(validFrom).add(config.wfhCodeTtlHours, "hour").toDate();

  await prisma.dailyWfhCode.create({
    data: {
      codeHash,
      validFrom,
      expiresAt,
      createdById: req.user!.id
    }
  });

  return res.status(201).json({
    code: plainCode,
    validFrom,
    expiresAt
  });
});

router.get("/attendance", requireAuth, requireAdmin, async (req, res) => {
  const dateParam = String(req.query.date || dayjs().format("YYYY-MM-DD"));
  const start = dayjs(dateParam).startOf("day").toDate();
  const end = dayjs(dateParam).endOf("day").toDate();

  const logs = await prisma.attendance.findMany({
    where: {
      date: {
        gte: start,
        lte: end
      }
    },
    include: {
      user: {
        select: {
          fullName: true,
          email: true
        }
      }
    },
    orderBy: { createdAt: "desc" }
  });

  return res.json(logs);
});

router.get("/attendance/export.csv", requireAuth, requireAdmin, async (_req, res) => {
  const logs = await prisma.attendance.findMany({
    include: {
      user: {
        select: {
          fullName: true,
          email: true
        }
      }
    },
    orderBy: { createdAt: "desc" }
  });

  const csv = stringify(
    logs.map((row) => ({
      user: row.user.fullName,
      email: row.user.email,
      date: row.date.toISOString(),
      clockInAt: row.clockInAt?.toISOString() || "",
      clockOutAt: row.clockOutAt?.toISOString() || "",
      totalMinutes: row.totalMinutes,
      clockInMode: row.clockInMode || "",
      clockOutMode: row.clockOutMode || "",
      clockInIp: row.clockInIp || "",
      clockOutIp: row.clockOutIp || ""
    })),
    { header: true }
  );

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=attendance.csv");
  return res.send(csv);
});

export default router;
