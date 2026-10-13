/* Local PCM previews only: peak envelopes are drawn from the decoded audio. */
function createWaveform(track, container, loadBuffer, getGrid) {
  const panel = document.createElement('section');
  panel.className = 'waveform';
  panel.innerHTML = `<div class="wave-tools"><label>Excerpt <select aria-label="Waveform excerpt"><option value="0">Start</option><option value="1">Middle</option><option value="2">End</option></select></label><label>Zoom <select aria-label="Waveform zoom"><option value="1">1× · 12 seconds</option><option value="2">2×</option><option value="4">4×</option><option value="8">8×</option></select></label><span class="wave-caption">Loading waveform…</span></div><canvas height="210" aria-label="Audio waveform with detected beat and editable grid markers"></canvas><label class="wave-pan">Visible window <input aria-label="Visible window position" type="range" min="0" max="0" step="0.01" value="0" disabled></label><small class="pan-help">Zoom in to move the visible window. At 1× the whole excerpt is visible.</small><small><span style="color:#f4b65d">Yellow dashed: detected beats</span> · <span style="color:#69e2cc">Green: fitted/editable grid</span> · White: playback cursor. The Click follows selector chooses which markers you hear. Click waveform to position playback. Times are seconds into the song.</small>`;
  container.append(panel);
  const canvas = panel.querySelector('canvas'), ctx = canvas.getContext('2d');
  const excerpt = panel.querySelector('[aria-label="Waveform excerpt"]');
  const zoom = panel.querySelector('[aria-label="Waveform zoom"]');
  const pan = panel.querySelector('input'), caption = panel.querySelector('.wave-caption');
  let clip = track.excerpts[0], buffer, cursor = 0, request = 0;
  function bounds() {
    const duration = buffer?.duration ?? 12;
    const span = duration / Number(zoom.value);
    pan.max = Math.max(0, duration - span);
    pan.disabled = !buffer || Number(pan.max) === 0;
    panel.querySelector('.pan-help').textContent = pan.disabled ? 'Zoom in to move the visible window. At 1× the whole excerpt is visible.' : 'Slide to inspect another part of this excerpt. This moves the view, not the playback cursor.';
    const start = Math.min(Number(pan.value), Number(pan.max));
    return {start, span, end: start + span};
  }
  function draw() {
    const width = Math.max(1, canvas.clientWidth), height = 210, dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(width*dpr) || canvas.height !== height*dpr) {canvas.width=Math.round(width*dpr);canvas.height=height*dpr}
    ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.fillStyle='#101b24';ctx.fillRect(0,0,width,height);
    if (!buffer) return;
    const {start,span,end}=bounds(), absolute=clip.start_seconds+start;
    const x = seconds => (seconds-start)/span*width;
    const data=buffer.getChannelData(0), sr=buffer.sampleRate;
    ctx.strokeStyle='#698797';ctx.lineWidth=1;ctx.beginPath();
    for(let px=0;px<width;px++){
      const from=Math.floor((start+px/width*span)*sr), to=Math.min(data.length,Math.ceil((start+(px+1)/width*span)*sr));
      let min=0,max=0;for(let i=from;i<to;i++){min=Math.min(min,data[i]);max=Math.max(max,data[i])}
      ctx.moveTo(px,105-min*74);ctx.lineTo(px,105-max*74);
    }ctx.stroke();
    function marker(seconds,color,dashed,top,bottom){const px=x(seconds-clip.start_seconds);ctx.strokeStyle=color;ctx.setLineDash(dashed?[4,4]:[]);ctx.beginPath();ctx.moveTo(px,top);ctx.lineTo(px,bottom);ctx.stroke();ctx.setLineDash([])}
    for(const beat of track.beats_seconds){if(beat>=absolute&&beat<=absolute+span)marker(beat,'#f4b65d',true,22,179)}
    try{const {bpm,offset}=getGrid(),period=60/bpm;
      const first=Math.ceil((absolute-offset)/period),last=Math.floor((absolute+span-offset)/period);
      for(let n=first;n<=last;n++)marker(offset+n*period,'#69e2cc',false,36,188);
    }catch{}
    ctx.font='11px system-ui';ctx.fillStyle='#acc0cf';ctx.textAlign='left';
    const step=span>6?2:span>3?1:.25;
    for(let t=Math.ceil(absolute/step)*step;t<=absolute+span;t+=step){const px=x(t-clip.start_seconds);ctx.fillText(t.toFixed(step<1?2:0)+'s',Math.min(px,width-40),202)}
    if(cursor>=start&&cursor<=end){marker(clip.start_seconds+cursor,'#ffffff',false,0,190);ctx.fillStyle='#fff';ctx.fillText('▼',Math.max(0,Math.min(width-12,x(cursor)-5)),12)}
    caption.textContent=`${clip.label} · ${absolute.toFixed(2)}–${(absolute+span).toFixed(2)} s · cursor ${(clip.start_seconds+cursor).toFixed(3)} s`;
  }
  async function select(next) {
    if (clip===next && buffer) return;
    clip=next;excerpt.value=String(track.excerpts.indexOf(next));buffer=null;cursor=0;pan.value=0;
    const token=++request;caption.textContent='Loading waveform…';draw();
    try{const decoded=await loadBuffer(next);if(token!==request)return;buffer=decoded;draw()}
    catch(error){if(token===request)caption.textContent=error.message}
  }
  excerpt.onchange=()=>{stop();select(track.excerpts[Number(excerpt.value)])};
  zoom.onchange=()=>{const span=(buffer?.duration??12)/Number(zoom.value);pan.max=Math.max(0,(buffer?.duration??12)-span);pan.value=Math.min(cursor,Number(pan.max));draw()};
  pan.oninput=draw;
  canvas.onclick=event=>{stop();const {start,span}=bounds();const rect=canvas.getBoundingClientRect();cursor=Math.max(0,Math.min((buffer?.duration??12)-.001,start+(event.clientX-rect.left)/rect.width*span));draw()};
  new ResizeObserver(draw).observe(canvas);
  select(clip);
  return {
    select, draw, get clip(){return clip}, get cursor(){return cursor},
    setCursor(value,follow=false){cursor=value;if(follow){const {start,end,span}=bounds();if(cursor<start||cursor>end)pan.value=Math.min(Number(pan.max),Math.floor(cursor/span)*span)}draw()},
    stop(){draw()}
  };
}
