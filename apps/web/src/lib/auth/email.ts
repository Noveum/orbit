export interface AuthEmail {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly url?: string;
}

export type EmailTransport = (message: AuthEmail) => Promise<void>;

const consoleTransport: EmailTransport = (message) => {
  console.info(
    `[email] to=${message.to} subject=${message.subject}${
      message.url === undefined ? '' : ` url=${message.url}`
    }\n${message.text}`,
  );
  return Promise.resolve();
};

let transport: EmailTransport = consoleTransport;

export function setEmailTransport(next: EmailTransport): void {
  transport = next;
}

export async function sendAuthEmail(message: AuthEmail): Promise<void> {
  await transport(message);
}
