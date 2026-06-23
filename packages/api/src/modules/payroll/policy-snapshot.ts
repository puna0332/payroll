/**
 * Policy Snapshot — Freeze chính sách lương/thuế/bảo hiểm cho kỳ lương
 *
 * Copies current policies for each employee,
 * marks them with the period key, deactivates old records.
 */

import { PrismaClient } from '@prisma/client';

const MODULE = '[Payroll:PolicySnapshot]';

/**
 * Create policy snapshots for all active employees in a period.
 *
 * Steps:
 * 1. Get all employees with is_current policies
 * 2. For each: clone salary/tax/insurance with period_key
 * 3. Deactivate old "current" records
 */
export async function createPolicySnapshots(
  periodId: string,
  prisma: PrismaClient,
): Promise<{ salary: number; tax: number; insurance: number }> {
  const period = await prisma.payrollPeriod.findUniqueOrThrow({ where: { id: periodId } });
  const mk = period.monthKey;

  // Get all active employees
  const employees = await prisma.employee.findMany({
    where: { status: 'ACTIVE' },
    select: { id: true },
  });

  let salaryCount = 0;
  let taxCount = 0;
  let insuranceCount = 0;

  for (const emp of employees) {
    // Salary snapshot
    const currentSalary = await prisma.salaryPolicy.findFirst({
      where: { employeeId: emp.id, isCurrent: true },
    });
    if (currentSalary) {
      // Check if snapshot already exists
      const existing = await prisma.salaryPolicy.findUnique({
        where: { employeeId_periodKey: { employeeId: emp.id, periodKey: mk } },
      });
      if (!existing) {
        await prisma.salaryPolicy.create({
          data: {
            employeeId: emp.id,
            periodKey: mk,
            isCurrent: false,
            baseSalary: currentSalary.baseSalary,
            offerSalary: currentSalary.offerSalary,
            ratio: currentSalary.ratio,
            rankAllowance: currentSalary.rankAllowance,
            bpqlAllowance: currentSalary.bpqlAllowance,
            salesAllowance: currentSalary.salesAllowance,
            technicalAllowance: currentSalary.technicalAllowance,
            languageAllowance: currentSalary.languageAllowance,
            housingAllowance: currentSalary.housingAllowance,
            transportAllowance: currentSalary.transportAllowance,
            mealAllowance: currentSalary.mealAllowance,
            phoneAllowance: currentSalary.phoneAllowance,
            attendanceAllowance: currentSalary.attendanceAllowance,
            dailyRate: currentSalary.dailyRate,
            hourlyRate: currentSalary.hourlyRate,
          },
        });
        salaryCount++;
      }
    }

    // Tax snapshot
    const currentTax = await prisma.taxPolicy.findFirst({
      where: { employeeId: emp.id, isCurrent: true },
    });
    if (currentTax) {
      const existing = await prisma.taxPolicy.findUnique({
        where: { employeeId_periodKey: { employeeId: emp.id, periodKey: mk } },
      });
      if (!existing) {
        await prisma.taxPolicy.create({
          data: {
            employeeId: emp.id,
            periodKey: mk,
            isCurrent: false,
            personalDeduction: currentTax.personalDeduction,
            dependents: currentTax.dependents,
            dependentDeduction: currentTax.dependentDeduction,
            taxCode: currentTax.taxCode,
          },
        });
        taxCount++;
      }
    }

    // Insurance snapshot
    const currentIns = await prisma.insurancePolicy.findFirst({
      where: { employeeId: emp.id, isCurrent: true },
    });
    if (currentIns) {
      const existing = await prisma.insurancePolicy.findUnique({
        where: { employeeId_periodKey: { employeeId: emp.id, periodKey: mk } },
      });
      if (!existing) {
        await prisma.insurancePolicy.create({
          data: {
            employeeId: emp.id,
            periodKey: mk,
            isCurrent: false,
            insuranceBasis: currentIns.insuranceBasis,
            bhxhEmployee: currentIns.bhxhEmployee,
            bhytEmployee: currentIns.bhytEmployee,
            bhtnEmployee: currentIns.bhtnEmployee,
            totalEmployee: currentIns.totalEmployee,
            bhxhEmployer: currentIns.bhxhEmployer,
            bhytEmployer: currentIns.bhytEmployer,
            bhtnEmployer: currentIns.bhtnEmployer,
            totalEmployer: currentIns.totalEmployer,
            grandTotal: currentIns.grandTotal,
          },
        });
        insuranceCount++;
      }
    }
  }

  console.log(`${MODULE} Snapshots created: ${salaryCount} salary, ${taxCount} tax, ${insuranceCount} insurance`);
  return { salary: salaryCount, tax: taxCount, insurance: insuranceCount };
}
