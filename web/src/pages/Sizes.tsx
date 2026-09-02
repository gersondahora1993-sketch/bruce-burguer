import CatalogPage from "./CatalogPage";

export default function Sizes() {
  return (
    <CatalogPage
      title="Tamanhos"
      subtitle="Tamanhos disponíveis para as variações de produto"
      endpoint="/api/sizes"
      placeholder="Ex.: 48, 50, N, GG Plus..."
      hint="Você pode criar quantos tamanhos precisar. Os padrões já cadastrados são PP, P, M, G, GG, XG e os numéricos de 34 a 46."
    />
  );
}