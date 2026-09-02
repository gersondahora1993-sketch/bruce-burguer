/**
 * Utilitário centralizado para determinar se a empresa está ABERTA ou FECHADA
 * baseado no horário de funcionamento configurado no banco de dados.
 * 
 * Horário oficial: Terça a sábado, das 18:30 às 23:00
 * Domingo e Segunda: FECHADO
 */

/**
 * Converte string de horário "HH:MM" para minutos desde meia-noite
 */
function timeToMinutes(timeStr: string): number {
  const [hours, minutes] = timeStr.split(":").map(Number);
  return hours * 60 + minutes;
}

/**
 * Parseia o campo hours da tabela business_settings
 * Formato esperado: "Terça a sábado, das 18:30 às 23:00"
 * Retorna objeto com dias da semana abertos, horário de abertura e fechamento em minutos
 */
export function parseBusinessHours(hoursStr: string): {
  openDays: number[]; // 0=Domingo, 1=Segunda, ..., 6=Sábado
  openMinutes: number;
  closeMinutes: number;
} | null {
  if (!hoursStr || typeof hoursStr !== "string") return null;
  
  // Normalizar string removendo acentos
  const normalize = (str: string) => str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  
  const str = normalize(hoursStr.trim());
  
  // Mapear dias da semana (sem acentos)
  const dayMap: Record<string, number> = {
    "domingo": 0,
    "segunda": 1,
    "segunda-feira": 1,
    "terca": 2,
    "terca-feira": 2,
    "quarta": 3,
    "quarta-feira": 3,
    "quinta": 4,
    "quinta-feira": 4,
    "sexta": 5,
    "sexta-feira": 5,
    "sabado": 6,
  };

  // Extrair horário: "das 18:30 às 23:00"
  const timeMatch = str.match(/das\s+(\d{1,2}:\d{2})\s*(?:as|ate|ate)\s*(\d{1,2}:\d{2})/);
  if (!timeMatch) return null;
  
  const openMinutes = timeToMinutes(timeMatch[1]);
  const closeMinutes = timeToMinutes(timeMatch[2]);
  
  if (isNaN(openMinutes) || isNaN(closeMinutes)) return null;
  
  // Determinar dias abertos
  const openDays: number[] = [];
  
  // Verificar formato "Terca a sabado" ou "Terca a sabado"
  const rangeMatch = str.match(/(?:segunda|terca|quarta|quinta|sexta|sabado|domingo)\s*(?:a|ate)\s*(?:segunda|terca|quarta|quinta|sexta|sabado|domingo)/);
  
  if (rangeMatch) {
    // Extrair dia inicial e final - dividir por " a " ou " ate " (como palavra completa)
    const parts = rangeMatch[0].split(/\s+(?:a|ate)\s+/);
    const startDay = parts[0].trim();
    const endDay = parts[1].trim();
    
    const start = dayMap[startDay];
    const end = dayMap[endDay];
    
    if (start !== undefined && end !== undefined) {
      for (let d = start; d <= end; d++) {
        openDays.push(d);
      }
    }
  } else {
    // Fallback: procurar dias individuais mencionados
    for (const [dayName, dayNum] of Object.entries(dayMap)) {
      if (str.includes(dayName)) {
        openDays.push(dayNum);
      }
    }
  }
  
  // Remover duplicatas e ordenar
  const uniqueDays = [...new Set(openDays)].sort((a, b) => a - b);
  
  return {
    openDays: uniqueDays,
    openMinutes,
    closeMinutes,
  };
}

/**
 * Verifica se a empresa está ABERTA no momento atual
 * @param hoursStr String de horário do campo hours da business_settings
 * @param now Date opcional para teste (padrão: agora)
 * @returns "ABERTO" | "FECHADO" | "ERRO_CONFIGURACAO"
 */
export function isBusinessOpen(hoursStr: string, now: Date = new Date()): "ABERTO" | "FECHADO" | "ERRO_CONFIGURACAO" {
  const parsed = parseBusinessHours(hoursStr);
  
  if (!parsed) {
    return "ERRO_CONFIGURACAO";
  }
  
  const { openDays, openMinutes, closeMinutes } = parsed;
  
  const currentDay = now.getDay(); // 0=Domingo, ..., 6=Sábado
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  
  // Verificar se hoje é dia de funcionamento
  if (!openDays.includes(currentDay)) {
    return "FECHADO";
  }
  
  // Verificar se está dentro do horário
  if (currentMinutes >= openMinutes && currentMinutes < closeMinutes) {
    return "ABERTO";
  }
  
  return "FECHADO";
}

/**
 * Retorna objeto detalhado com status e informações adicionais
 */
export function getBusinessStatus(hoursStr: string, now: Date = new Date()) {
  const status = isBusinessOpen(hoursStr, now);
  const parsed = parseBusinessHours(hoursStr);
  
  return {
    status,
    isOpen: status === "ABERTO",
    nextChange: parsed ? getNextStatusChange(parsed, now) : null,
    hoursConfig: hoursStr,
  };
}

/**
 * Calcula quando será a próxima mudança de status (abertura/fechamento)
 */
function getNextStatusChange(
  parsed: { openDays: number[]; openMinutes: number; closeMinutes: number },
  now: Date
): { type: "open" | "close"; date: Date } | null {
  const currentDay = now.getDay();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  
  // Se hoje é dia de funcionamento
  if (parsed.openDays.includes(currentDay)) {
    if (currentMinutes < parsed.openMinutes) {
      // Ainda não abriu hoje
      return { type: "open", date: new Date(now.getFullYear(), now.getMonth(), now.getDate(), Math.floor(parsed.openMinutes / 60), parsed.openMinutes % 60) };
    } else if (currentMinutes < parsed.closeMinutes) {
      // Está aberto, fecha hoje
      return { type: "close", date: new Date(now.getFullYear(), now.getMonth(), now.getDate(), Math.floor(parsed.closeMinutes / 60), parsed.closeMinutes % 60) };
    }
    // Já fechou hoje, procurar próximo dia
  }
  
  // Procurar próximo dia de funcionamento
  for (let i = 1; i <= 7; i++) {
    const nextDay = (currentDay + i) % 7;
    if (parsed.openDays.includes(nextDay)) {
      const nextDate = new Date(now);
      nextDate.setDate(now.getDate() + i);
      nextDate.setHours(Math.floor(parsed.openMinutes / 60), parsed.openMinutes % 60, 0, 0);
      return { type: "open", date: nextDate };
    }
  }
  
  return null;
}

export default {
  isBusinessOpen,
  getBusinessStatus,
  parseBusinessHours,
};