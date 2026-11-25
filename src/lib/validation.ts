import { z } from "zod";
export const uuid = z.string().uuid();
const money = z.string().regex(/^\d{1,7}\.\d{2}$/).refine(v => Number(v) > 0 && Number(v) <= Number(process.env.DEMO_MAX_AMOUNT || 1000), "Valor fora do limite da demo.");
export const createOrderSchema = z.object({
  request_id: uuid,
  acquirer_registration_id: uuid,
  name: z.string().trim().min(1).max(255).optional(),
  description: z.string().trim().min(3).max(180),
  billing_type: z.enum(["ONE_TIME", "RECURRING"]),
  amount: money.optional(),
  payment_methods: z.array(z.enum(["CREDIT", "DEBIT", "PIX"])).min(1).max(3),
  max_installments: z.number().int().min(1).max(12),
  recurrence: z.object({ installments: z.array(z.object({ amount: money, due_date: z.iso.date(), card_installments: z.number().int().min(1).max(12) }).strict()).min(2).max(12) }).strict().optional(),
}).strict().superRefine((v, ctx) => {
  if (v.billing_type === "ONE_TIME" && (!v.amount || v.recurrence)) ctx.addIssue({ code: "custom", message: "Cobrança avulsa exige valor e não aceita recorrência." });
  if (v.billing_type === "RECURRING") {
    if (v.amount || !v.recurrence || !v.payment_methods.includes("CREDIT")) ctx.addIssue({ code: "custom", message: "Recorrência exige crédito e um calendário, sem valor avulso." });
    const dates = v.recurrence?.installments.map(i => i.due_date) || [];
    if (dates.some((d, i) => i > 0 && d <= dates[i - 1])) ctx.addIssue({ code: "custom", message: "As datas das ocorrências devem ser crescentes." });
  }
});
const phone = z.object({ country_code: z.string().regex(/^\d{1,3}$/), area_code: z.string().regex(/^\d{1,4}$/), number: z.string().regex(/^\d{6,20}$/) }).strict();
const payer = z.object({ name: z.string().trim().min(2).max(255), email: z.email().max(255), document: z.string().regex(/^(\d{11}|\d{14})$/).optional() }).strict();
const billing_address = z.object({ country: z.literal("BR"), zip_code: z.string().regex(/^\d{8}$/), state: z.string().length(2), city: z.string().min(1).max(100), street: z.string().min(1).max(255), district: z.string().min(1).max(100), street_number: z.string().min(1).max(20), complement: z.string().max(100).optional() }).strict();
const browser = z.object({
  http_accept_browser_value: z.string().min(1).max(2048), http_browser_java_script_enabled: z.boolean(), http_browser_java_enabled: z.boolean(),
  http_browser_language: z.string().min(1).max(20), http_browser_color_depth: z.number().int().min(1).max(64),
  http_browser_screen_height: z.number().int().min(1).max(10000), http_browser_screen_width: z.number().int().min(1).max(10000),
  http_browser_time_difference: z.number().int().min(-1440).max(1440), user_agent_browser_value: z.string().min(1).max(2048),
}).strict();
const encrypted = z.string().min(128).max(2048).regex(/^[A-Za-z0-9+/]+={0,2}$/);
export const confirmSchema = z.object({ payment_method: z.enum(["CREDIT", "DEBIT"]), card: z.object({ brand: z.enum(["VISA", "MASTERCARD", "ELO", "HIPERCARD", "AMEX"]), number: encrypted, expiration_month: encrypted, expiration_year: encrypted }).strict() }).strict();
export const cardSchema = z.object({ payment_method_id: uuid, payment_method: z.enum(["CREDIT", "DEBIT"]), installments: z.number().int().min(1).max(12), card: z.object({ security_code: encrypted }).strict(), payer, browser, phone: phone.optional(), billing_address: billing_address.optional(), recurring_consent: z.boolean().optional(), consent_terms_version: z.string().min(1).max(100).optional(), apply_payment_method_to_remaining_installments: z.boolean().optional() }).strict();
export const pixSchema = z.object({ payer: z.object({ name: z.string().min(2).max(255).optional(), document: z.string().regex(/^(\d{11}|\d{14})$/).optional() }).strict().optional(), phone: phone.optional(), card_setup_id: uuid.optional() }).strict();
export const attemptSchema = z.object({ request_id: uuid, payload: z.record(z.string(), z.unknown()) }).strict();
