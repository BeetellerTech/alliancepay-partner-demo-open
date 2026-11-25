export type ChargeRow = { amount: string; due_date: string; card_installments: number };
export function localToday() { return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date()); }
export function cents(value: string | number) { return Math.round(Number(value) * 100); }
export function shiftDate(date: string, index: number, frequency: "MONTHLY" | "WEEKLY") {
  const [year, month, day] = date.split("-").map(Number);
  if (frequency === "WEEKLY") return new Date(Date.UTC(year, month - 1, day + index * 7)).toISOString().slice(0, 10);
  const last = new Date(Date.UTC(year, month + index, 0)).getUTCDate();
  return new Date(Date.UTC(year, month - 1 + index, Math.min(day, last))).toISOString().slice(0, 10);
}
export function makeSchedule(total: string, entry: string, count: number, start: string, frequency: "MONTHLY" | "WEEKLY", today: string): ChargeRow[] {
  const totalCents = cents(total), entryCents = cents(entry || "0"), rest = totalCents - entryCents;
  if (!Number.isInteger(totalCents) || !Number.isInteger(entryCents) || entryCents < 0 || rest < count || count < (entryCents > 0 ? 1 : 2) || count + (entryCents > 0 ? 1 : 0) > 12 || !/^\d{4}-\d{2}-\d{2}$/.test(start)) throw new Error("Informe um total maior que a entrada e de 2 a 12 cobranças, incluindo a entrada.");
  if (start < today || (entryCents > 0 && start <= today)) throw new Error("A primeira parcela deve vencer após a entrada de hoje. Sem entrada, pode vencer hoje.");
  const rows: ChargeRow[] = entryCents ? [{ amount: (entryCents / 100).toFixed(2), due_date: today, card_installments: 1 }] : [];
  for (let i = 0; i < count; i++) rows.push({ amount: ((Math.floor(rest / count) + (i < rest % count ? 1 : 0)) / 100).toFixed(2), due_date: shiftDate(start, i, frequency), card_installments: 1 });
  if (rows.some(row => cents(row.amount) > 100000)) throw new Error("Cada cobrança deve ter valor de até R$ 1.000,00 nesta demo.");
  return rows;
}
export function scheduleError(rows: ChargeRow[], today: string) {
  if (rows.length < 2 || rows.length > 12) return "Use de 2 a 12 cobranças no calendário.";
  if (rows.some(row => !Number.isFinite(cents(row.amount)) || cents(row.amount) < 1 || cents(row.amount) > 100000)) return "Informe valores entre R$ 0,01 e R$ 1.000,00 em cada cobrança.";
  if (rows.some((row, i) => !row.due_date || row.due_date < today || (i > 0 && row.due_date <= rows[i - 1].due_date))) return "Os vencimentos devem estar em ordem crescente, a partir de hoje.";
  return "";
}
