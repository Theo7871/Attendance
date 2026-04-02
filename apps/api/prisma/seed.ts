import bcrypt from "bcryptjs";
import { PrismaClient, Role } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const theoPasswordHash = await bcrypt.hash("Theo@7871", 10);

  await prisma.user.upsert({
    where: { email: "theotheo031@gmail.com" },
    update: {},
    create: {
      fullName: "Theo",
      email: "theotheo031@gmail.com",
      passwordHash: theoPasswordHash,
      role: Role.ADMIN,
      isApproved: true
    }
  });

  console.log("Seed completed.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
