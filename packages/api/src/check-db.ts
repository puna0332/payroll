import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const list = await prisma.approvalRecord.findMany({
    where: {
      OR: [
        { serialNumber: { contains: '0026' } },
        { instanceCode: { contains: '0026' } }
      ]
    },
    select: { id: true, serialNumber: true, instanceCode: true, approvalType: true, employee: { select: { fullName: true } } }
  });
  console.log("MATCHING 0026 APPROVALS:", list);
}

main().catch(console.error).finally(() => prisma.$disconnect());
