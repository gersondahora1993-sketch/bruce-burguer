import CatalogPage from "./CatalogPage";

export default function Colors() {
  return (
    <CatalogPage
      title="Cores"
      subtitle="Cores disponíveis para as variações de produto"
      endpoint="/api/colors"
      placeholder="Ex.: Dourado, Azul-marinho..."
      colorPicker
      hint="As cores cadastradas aqui aparecem como opções na hora de montar as variações do produto."
    />
  );
}