import { createCanvas,loadImage } from '@napi-rs/canvas';
import { writeFile } from 'node:fs/promises';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
export async function rasterPDF(pdf:Buffer,prefix:string,signal:AbortSignal,expectedPages:number) {
 const loading=getDocument({data:new Uint8Array(pdf),useSystemFonts:false});const document=await loading.promise;
 try{if(document.numPages!==expectedPages)throw new Error(`PDF has ${document.numPages} pages; expected ${expectedPages}. Check print pagination.`);const thumbnails:Buffer[]=[];
  for(let i=1;i<=document.numPages;i++){signal.throwIfAborted();const page=await document.getPage(i),viewport=page.getViewport({scale:1.25});const content=await page.getTextContent();if(content.items.filter(v=>'str'in v&&v.str.trim()).length<5)throw new Error('PDF page '+i+' is empty or unreadable');const canvas=createCanvas(Math.ceil(viewport.width),Math.ceil(viewport.height));await page.render({canvas:canvas as any,canvasContext:canvas.getContext('2d') as any,viewport}).promise;const png=canvas.toBuffer('image/png');await writeFile(`${prefix}-page-${i}.png`,png,{mode:0o600});thumbnails.push(png);}
  const sheet=createCanvas(794,1123),ctx=sheet.getContext('2d');ctx.fillStyle='#ececf1';ctx.fillRect(0,0,794,1123);const w=240,h=339;for(let i=0;i<thumbnails.length;i++){const image=await loadImage(thumbnails[i]);ctx.drawImage(image,15+(i%3)*258,15+Math.floor(i/3)*365,w,h);}await writeFile(`${prefix}-contact.png`,sheet.toBuffer('image/png'),{mode:0o600});return document.numPages;
 }finally{await loading.destroy();}
}
