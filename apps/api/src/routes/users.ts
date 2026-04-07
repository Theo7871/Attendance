import { Router } from "express";
import bcrypt from "bcryptjs";
import { Role } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAdmin, requireAuth } from "../middleware/auth.js";

const router = Router();

function firstZodErrorMessage(error: z.ZodError): string {
  return error.issues[0]?.message || "Invalid payload.";
}

const latitudeInput = z.preprocess(
  (value) => (value === "" || value === null || value === undefined ? undefined : value),
  z.coerce.number().min(-90, "Latitude must be between -90 and 90").max(90, "Latitude must be between -90 and 90")
);

const longitudeInput = z.preprocess(
  (value) => (value === "" || value === null || value === undefined ? undefined : value),
  z.coerce.number().min(-180, "Longitude must be between -180 and 180").max(180, "Longitude must be between -180 and 180")
);

router.get("/", requireAuth, requireAdmin, async (_req, res) => {
  const users = await prisma.user.findMany({
    select: {
      id: true,
      fullName: true,
      email: true,
      role: true,
      wfhEnabled: true,
      homeLatitude: true,
      homeLongitude: true,
      isActive: true,
      isApproved: true,
      createdAt: true
    },
    orderBy: { createdAt: "desc" }
  });

  return res.json(users);
});

router.post("/", requireAuth, requireAdmin, async (req, res) => {
  const schema = z.object({
    fullName: z.string().min(2),
    email: z.string().email(),
    password: z.string().min(6),
    role: z.nativeEnum(Role).default(Role.STAFF),
    wfhEnabled: z.boolean().default(true),
    homeLatitude: latitudeInput.optional(),
    homeLongitude: longitudeInput.optional()
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: firstZodErrorMessage(parsed.error) });
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, 10);

  const existing = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (existing) {
    return res.status(409).json({ message: "Email is already in use." });
  }

  const user = await prisma.user.create({
    data: {
      fullName: parsed.data.fullName,
      email: parsed.data.email,
      passwordHash,
      role: parsed.data.role,
      wfhEnabled: parsed.data.wfhEnabled,
      homeLatitude: parsed.data.homeLatitude,
      homeLongitude: parsed.data.homeLongitude
    }
  });

  return res.status(201).json({ id: user.id });
});

router.put("/:id", requireAuth, requireAdmin, async (req, res) => {
  const schema = z.object({
    fullName: z.string().min(2).optional(),
    email: z.string().email().optional(),
    password: z.string().min(6).optional(),
    role: z.nativeEnum(Role).optional(),
    wfhEnabled: z.boolean().optional(),
    homeLatitude: z.union([latitudeInput, z.null()]).optional(),
    homeLongitude: z.union([longitudeInput, z.null()]).optional(),
    isActive: z.boolean().optional()
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: firstZodErrorMessage(parsed.error) });
  }

  const targetId = String(req.params.id);
  const target = await prisma.user.findUnique({ where: { id: targetId } });
  if (!target) {
    return res.status(404).json({ message: "User not found." });
  }

  if (parsed.data.email && parsed.data.email !== target.email) {
    const emailTaken = await prisma.user.findUnique({ where: { email: parsed.data.email } });
    if (emailTaken) {
      return res.status(409).json({ message: "Email is already in use." });
    }
  }

  const passwordHash = parsed.data.password ? await bcrypt.hash(parsed.data.password, 10) : undefined;

  await prisma.user.update({
    where: { id: targetId },
    data: {
      fullName: parsed.data.fullName,
      email: parsed.data.email,
      passwordHash,
      role: parsed.data.role,
      wfhEnabled: parsed.data.wfhEnabled,
      homeLatitude: parsed.data.homeLatitude,
      homeLongitude: parsed.data.homeLongitude,
      isActive: parsed.data.isActive
    }
  });

  return res.json({ ok: true });
});

router.delete("/:id", requireAuth, requireAdmin, async (req, res) => {
  const targetId = String(req.params.id);

  const target = await prisma.user.findUnique({ where: { id: targetId } });
  if (!target) {
    return res.status(404).json({ message: "User not found." });
  }

  if (target.role === "ADMIN") {
    return res.status(400).json({ message: "Admin accounts cannot be deleted." });
  }

  await prisma.user.delete({ where: { id: targetId } });
  return res.json({ ok: true });
});

router.get("/pending", requireAuth, requireAdmin, async (_req, res) => {
  const pending = await prisma.user.findMany({
    where: { isApproved: false },
    select: {
      id: true,
      fullName: true,
      email: true,
      role: true,
      isActive: true,
      createdAt: true
    },
    orderBy: { createdAt: "asc" }
  });

  return res.json(pending);
});

router.patch("/:id/approve", requireAuth, requireAdmin, async (req, res) => {
  const targetId = String(req.params.id);
  const { approve } = req.body;

  const target = await prisma.user.findUnique({ where: { id: targetId } });
  if (!target) {
    return res.status(404).json({ message: "User not found." });
  }

  if (approve) {
    await prisma.user.update({
      where: { id: targetId },
      data: { isApproved: true }
    });
    return res.json({ message: "User approved." });
  } else {
    await prisma.user.delete({ where: { id: targetId } });
    return res.json({ message: "User rejected and deleted." });
  }
});

export default router;
