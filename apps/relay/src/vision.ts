/** Explicit, separately consented Gemini screenshot analysis.

A screenshot is first captured by the user's paired controller with its own
approval. A SECOND intentional user action shares the image with Google for
visual explanation only. No visual output is ever executed as a PC command.
*/
import { readFile } from 'node:fs/promises';
import { HttpError } from './core';

export async function analyzeScreenshot(
  path:string,
  question:string,
  options:{fetcher?:typeof fetch;key?:string;model?:string}={}
):Promise<{analysis:string;imageSharedWith:'Google Gemini';actionsExecuted:false}> {
  if(typeof question!=='string'||question.trim().length<3||question.length>450)
    throw new HttpError(400,'VISION_QUESTION','Question must contain 3–450 characters');
  const key=options.key??process.env.GEMINI_API_KEY;
  const model=options.model??process.env.GEMINI_MODEL??'gemini-3.5-flash-lite';
  if(!key||!/^gemini-[a-z0-9.-]{3,55}$/.test(model))
    throw new HttpError(503,'VISION_NOT_CONFIGURED','Gemini image analysis is not configured');
  // Screenshot paths are resolved from owner-scoped HUKM database, NOT user input.
  let bytes:Buffer;
  try {bytes=await readFile(path);}catch{throw new HttpError(404,'SCREENSHOT_MISSING','Screenshot not found');}
  if(bytes.length<50||bytes.length>2_500_000)
    throw new HttpError(400,'SCREENSHOT_SIZE','Screenshot outside supported size');
  // Validate JPEG or PNG magic; never send arbitrary private files to Gemini.
  const jpeg=bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff;
  const png=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  if(!jpeg&&!png)throw new HttpError(400,'SCREENSHOT_TYPE','Screenshot must be JPEG or PNG');
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),25000);
  try{
    const res=await (options.fetcher??fetch)(
      'https://generativelanguage.googleapis.com/v1beta/models/'+model+':generateContent',{
        method:'POST',
        headers:{'content-type':'application/json','x-goog-api-key':key},
        body:JSON.stringify({
          systemInstruction:{parts:[{text:[
            'You are HUKM screen observer. Analyze only the user-approved screenshot.',
            'Be concise, factual, answer in Roman Urdu with some English.',
            'Clearly distinguish visible labels from guesses; if unreadable say so.',
            'Never imply actions have been taken. Never ask for passwords/OTP.',
            'Do not transcribe passwords, private chat bodies, financial or login data.',
            'Do not output executable shell commands or coordinate-click plans.',
            'Suggest only general safe next steps that the user can review.'
          ].join(' ')}]},
          contents:[{role:'user',parts:[
            {text:question.slice(0,450)},
            {inlineData:{mimeType:jpeg?'image/jpeg':'image/png',data:bytes.toString('base64')}}
          ]}],
          generationConfig:{temperature:0.1,maxOutputTokens:600},
        }),
        signal:controller.signal,
      });
    if(!res.ok)throw new HttpError(502,'VISION_UPSTREAM','Gemini image analysis unavailable');
    const raw=await res.text();
    if(raw.length>150000)throw new HttpError(502,'VISION_RESPONSE','Oversized Gemini response');
    let parsed:any;
    try{parsed=JSON.parse(raw);}catch{throw new HttpError(502,'VISION_RESPONSE','Invalid Gemini response');}
    const analysis=parsed?.candidates?.[0]?.content?.parts?.filter((p:any)=>typeof p?.text==='string')
      .map((p:any)=>p.text).join('\n').trim();
    if(!analysis)throw new HttpError(502,'VISION_NO_REPLY','Gemini did not recognize this screenshot');
    return {analysis:analysis.slice(0,2400),imageSharedWith:'Google Gemini',actionsExecuted:false};
  }catch(e){
    if(e instanceof HttpError)throw e;
    if(controller.signal.aborted)throw new HttpError(504,'VISION_TIMEOUT','Gemini vision timed out');
    throw new HttpError(502,'VISION_CONNECTION','Gemini vision request failed');
  }finally{clearTimeout(timer);}
}
