const NOT_CONFIGURED_MESSAGE = "Emissão fiscal não configurada. Conecte um provedor fiscal (SEFAZ/emissor homologado) nas configurações antes de emitir documentos. Nenhum documento foi autorizado.";
export class NotConfiguredProvider {
    name = "nenhum";
    configured = false;
    notConfigured(op) {
        return {
            ok: false,
            configured: false,
            message: `${NOT_CONFIGURED_MESSAGE} (operação: ${op})`,
            status: "nao_configurado",
        };
    }
    emitirNfce(_input) {
        return this.notConfigured("emitirNfce");
    }
    consultarDocumento(_ref) {
        return this.notConfigured("consultarDocumento");
    }
    cancelarDocumento(_ref, _reason) {
        return this.notConfigured("cancelarDocumento");
    }
    obterXml(_ref) {
        return this.notConfigured("obterXml");
    }
    obterDanfe(_ref) {
        return this.notConfigured("obterDanfe");
    }
    obterQrCode(_ref) {
        return this.notConfigured("obterQrCode");
    }
}
/**
 * Ponto único de seleção do provedor fiscal.
 * Hoje retorna sempre o provedor "não configurado" (seguro).
 * A integração real (SEFAZ/provedor homologado) substituirá este retorno
 * por um provider concreto configurado via DADOS FISCAIS em settings.
 */
let activeProvider = new NotConfiguredProvider();
export function getFiscalProvider() {
    return activeProvider;
}
export function setFiscalProvider(provider) {
    activeProvider = provider;
}
