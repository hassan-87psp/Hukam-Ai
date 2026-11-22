/**
 * Safe, deterministic "AI se pocho" intent. This means the owner's signed-in
 * ChatGPT browser on their paired Windows PC, NOT a silent Gemini API call.
 * No browser action is allowed from a quoted/reference question alone.
 */
export type ChatGPTAsk={question:string|null};

export function parseChatGPTAsk(input:string):ChatGPTAsk|null {
  const t=input.trim()
    .replace(/^(?:(?:hey|hello)\s+)?(?:hukm|hukam)\s*[,!:-]?\s*/i,'')
    .replace(/\s+/g,' ').trim();
  const patterns=[
    /^(?:chat\s*gpt|ai)\s+(?:se|ko|par|pe|mein|me)\s+(?:(?:zara|jara|please|ye|yeh|aik\s+sawal)\s+)?(?:pocho|pucho|poochho|puchho|pooch\s+lo|puch\s+lo|ask|sawal\s+karo|bolo|kaho|keh\s+do)\b\s*(?:ke|ki|:|-)?\s*(.*)$/i,
    /^(?:ask|pocho|pucho|pochho|poochho)\s+(?:chat\s*gpt|ai)\s*(?::|-|se)?\s*(.*)$/i,
  ];
  for(const pattern of patterns){
    const m=t.match(pattern);
    if(m){
      const q=m[1].trim().replace(/^[:\-]\s*/,'');
      return {question:q||null};
    }
  }
  return null;
}
export function chatGPTSendApproval(value:string):boolean{
  return /^(?:(?:haan|han|yes|ok|okay)\s*[, ]\s*)?(?:bhej\s*do|bhejo|send(?:\s+(?:karo|kar\s*do|now))?|submit(?:\s+(?:karo|kar\s*do))?|pooch\s*(?:lo|do)|puch\s*(?:lo|do))$/i.test(value.trim());
}
export function chromeProfile(value:string):string|null{
  const m=value.trim().match(/^(?:chrome\s+)?(default|profile\s+([1-9][0-9]?))(?:\s+(?:wala|wali|use\s+karo))?$/i);
  if(!m)return null;
  return m[2]?'Profile '+m[2]:'Default';
}
