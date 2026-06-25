export interface WhatsAppSendResult {
  status: 'sent' | 'failed' | 'bypassed_no_credentials';
  providerRef: string | null;
  errorLog: string | null;
}

export interface WhatsAppProvider {
  /** Sends a pre-compiled message body to a phone number for a given company. */
  send(companyId: string, phone: string, messageText: string): Promise<WhatsAppSendResult>;
  /** Verifies the provider's credentials are valid by calling the real API — never a fake success. */
  testConnection(companyId: string): Promise<{ connected: boolean; detail: string }>;
}
