/**
 * Sample requirements for the one-click demos. The three stories are made up
 * for this project and contain deliberate ambiguities for the agents to find.
 * The fourth is a public GitHub issue. No client or company data is used.
 */

export interface Sample {
  id: string;
  level: string;
  title: string;
  teaser: string;
  input: { kind: "text"; text: string; title: string } | { kind: "github"; url: string };
}

export const SAMPLES: readonly Sample[] = [
  {
    id: "wallet-topup",
    level: "CASE 01",
    title: "Wallet top-up",
    teaser: "Fintech. \"Fast and secure\", with no numbers anywhere.",
    input: {
      kind: "text",
      title: "Wallet top-up with a debit card",
      text: `As a customer, I want to top up my wallet with a debit card so I can pay merchants quickly.

Top-ups should be fast and secure. The user enters an amount and card details and gets a confirmation. Failed payments should show an error. Large amounts may need extra verification. The new balance is shown after a successful top-up, and the customer can see the top-up in their transaction history.`,
    },
  },
  {
    id: "clinic-booking",
    level: "CASE 02",
    title: "Clinic appointments",
    teaser: "Healthcare. Rescheduling is allowed up to a \"reasonable time\" before.",
    input: {
      kind: "text",
      title: "Book, reschedule or cancel a clinic appointment",
      text: `Patients can book, reschedule or cancel an appointment with a doctor from the app.

Rescheduling is allowed up to a reasonable time before the appointment. The patient and doctor are notified of changes. Doctors set their availability weekly. A patient cannot have two appointments at the same time. Cancelled slots become available to other patients.`,
    },
  },
  {
    id: "password-reset",
    level: "CASE 03",
    title: "Password reset",
    teaser: "Security. The link expires after \"some time\".",
    input: {
      kind: "text",
      title: "Reset a forgotten password by email",
      text: `Users who forget their password can request a reset link by email.

The link expires after some time. The new password must be strong. After the reset, the user is logged in. If the email address is not registered, the user should be told what to do next. Users should not be able to reuse a recent password.`,
    },
  },
  {
    id: "github-issue",
    level: "BONUS",
    title: "Public GitHub issue",
    teaser: "Fetches a real issue and searches the repo's closed bugs for lessons.",
    input: {
      kind: "github",
      url: "https://github.com/microsoft/playwright/issues/30976",
    },
  },
] as const;

export function findSample(id: string | undefined): Sample | undefined {
  return SAMPLES.find((sample) => sample.id === id);
}
