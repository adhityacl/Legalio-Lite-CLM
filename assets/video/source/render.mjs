/** Run from repo root: PYTHONPATH=/tmp/legalio-video-deps node assets/video/source/render.mjs
 * Needs @playwright/test (repo dev dependency), Chromium, Python numpy/imageio-ffmpeg.
 * FFMPEG may override the executable. All animation is rendered at deterministic timestamps.
 */
import { chromium } from '@playwright/test';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
const here=dirname(fileURLToPath(import.meta.url)),out=dirname(here);
const scratch=mkdtempSync(join(tmpdir(),'legalio-film-'));
const ffmpeg=process.env.FFMPEG || execFileSync('python',['-c','import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())'],{encoding:'utf8'}).trim();
const browser=await chromium.launch({headless:true,args:['--allow-file-access-from-files']});
try {
 const page=await browser.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:1});
 await page.goto(new URL('film.html',import.meta.url).href);
 await page.evaluate(()=>window.ready);
 for(let i=0;i<5;i++){
  await page.evaluate(t=>window.render(t),i*3+1.8);
  await page.screenshot({path:`/tmp/legalio-scene-${i+1}.png`});
 }
 await page.evaluate(()=>window.render(13.9));
 await page.screenshot({path:join(out,'legalio-poster.png')});
 if(!process.argv.includes('--stills')){
  const audio=join(scratch,'soundtrack.wav');
  execFileSync('python',[join(here,'soundtrack.py'),audio],{stdio:'inherit'});
  const video=join(out,'legalio-intro.mp4');
  const encoder=spawn(ffmpeg,['-y','-hide_banner','-loglevel','warning','-f','image2pipe','-framerate','30','-vcodec','mjpeg','-i','pipe:0','-i',audio,'-map','0:v','-map','1:a','-c:v','libx264','-preset','medium','-crf','19','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-t','15','-movflags','+faststart',video],{stdio:['pipe','inherit','inherit']});
  const done=once(encoder,'close');
  for(let frame=0;frame<450;frame++){
   const uri=await page.evaluate(async t=>{await window.render(t);return document.querySelector('canvas').toDataURL('image/jpeg',.95)},frame/30);
   if(!encoder.stdin.write(Buffer.from(uri.split(',')[1],'base64')))await once(encoder.stdin,'drain');
   if(frame%90===0)console.log(`Rendered ${frame}/450 frames`);
  }
  encoder.stdin.end();
  const [code]=await done;if(code!==0)throw new Error(`FFmpeg exited ${code}`);
  execFileSync(ffmpeg,['-y','-hide_banner','-loglevel','warning','-i',video,'-filter_complex','fps=12,scale=800:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4','-loop','0',join(out,'legalio-preview.gif')],{stdio:'inherit'});
  console.log('Exported 15-second Full HD MP4 with audio, animated README preview, and poster.');
 }
} finally {await browser.close();rmSync(scratch,{recursive:true,force:true})}
