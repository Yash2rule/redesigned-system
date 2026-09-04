export {
  ResendTransport,
  RecordingTransport,
  getEmailTransport,
  setEmailTransport,
  emailConfigured,
  sendEmail,
  sendEach,
  MAX_RECIPIENTS_PER_MESSAGE,
} from "./transport.ts";
export type { EmailMessage, EmailTransport, SendResult } from "./transport.ts";
export { unsubscribeFooter, plainTextEmail } from "./format.ts";
export type { EmailBody } from "./format.ts";
