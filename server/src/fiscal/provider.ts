export type FiscalDocType = "nfce" | "nfe";

export type FiscalDocStatus =
  | "nao_configurado"
  | "pendente_provedor"
  | "autorizado"
  | "rejeitado"
  | "cancelado";

export interface FiscalEmitInput {
  saleId: number;
  totalCents: number;
  customerName: string;
  items: { name: string; color: string; size: string; quantity: number; unitPriceCents: number; lineCents: number }[];
  type: FiscalDocType;
}

export interface FiscalDocumentRef {
  documentId: number;
  saleId: number;
}

export interface FiscalResult {
  ok: boolean;
  configured: boolean;
  message: string;
  status?: FiscalDocStatus;
  number?: string;
  series?: string;
  access_key?: string;
  protocol?: string;
  xml?: string;
  issued_at?: string;
  qr_code?: string;
  danfe_url?: string;
}

export interface FiscalProvider {
  readonly name: string;
  readonly configured: boolean;
  emitirNfce(input: FiscalEmitInput): FiscalResult;
  consultarDocumento(ref: FiscalDocumentRef): FiscalResult;
  cancelarDocumento(ref: FiscalDocumentRef, reason: string): FiscalResult;
  obterXml(ref: FiscalDocumentRef): FiscalResult;
  obterDanfe(ref: FiscalDocumentRef): FiscalResult;
  obterQrCode(ref: FiscalDocumentRef): FiscalResult;
}

const NOT_CONFIGURED_MESSAGE =
  "Emissão fiscal não configurada. Conecte um provedor fiscal (SEFAZ/emissor homologado) nas configurações antes de emitir documentos. Nenhum documento foi autorizado.";

export class NotConfiguredProvider implements FiscalProvider {
  readonly name = "nenhum";
  readonly configured = false;

  private notConfigured(op: string): FiscalResult {
    return {
      ok: false,
      configured: false,
      message: `${NOT_CONFIGURED_MESSAGE} (operação: ${op})`,
      status: "nao_configurado",
    };
  }

  emitirNfce(_input: FiscalEmitInput): FiscalResult {
    return this.notConfigured("emitirNfce");
  }
  consultarDocumento(_ref: FiscalDocumentRef): FiscalResult {
    return this.notConfigured("consultarDocumento");
  }
  cancelarDocumento(_ref: FiscalDocumentRef, _reason: string): FiscalResult {
    return this.notConfigured("cancelarDocumento");
  }
  obterXml(_ref: FiscalDocumentRef): FiscalResult {
    return this.notConfigured("obterXml");
  }
  obterDanfe(_ref: FiscalDocumentRef): FiscalResult {
    return this.notConfigured("obterDanfe");
  }
  obterQrCode(_ref: FiscalDocumentRef): FiscalResult {
    return this.notConfigured("obterQrCode");
  }
}

/**
 * Ponto único de seleção do provedor fiscal.
 * Hoje retorna sempre o provedor "não configurado" (seguro).
 * A integração real (SEFAZ/provedor homologado) substituirá este retorno
 * por um provider concreto configurado via DADOS FISCAIS em settings.
 */
let activeProvider: FiscalProvider = new NotConfiguredProvider();

export function getFiscalProvider(): FiscalProvider {
  return activeProvider;
}

export function setFiscalProvider(provider: FiscalProvider): void {
  activeProvider = provider;
}