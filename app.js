'use strict';

(function bootstrapSigner(globalScope, doc, cryptoApi, pdfLibRef, qrcodeRef, pdfjsRef) {

  /* ===== CONFIG ===== */
  const CONFIG = Object.freeze({
    versao: '4.1-DP-Trilha-Seguranca',
    storageKey: 'asn_hist_v2',
    storageLgpdKey: 'asn_lgpd_ack_v2',
    maxFileSize: 20 * 1024 * 1024,
    maxNomeLen: 100, maxEmailLen: 100, maxCargoLen: 80, maxSigTextLen: 60,
    pdfMagic: Object.freeze([0x25, 0x50, 0x44, 0x46, 0x2D]),
    fontsEnum: Object.freeze(['Dancing Script', 'Great Vibes', 'Caveat']),
    trilhaSegurancaPadrao: Object.freeze({
      versao:'TRILHA-SEGURANCA-DP-1.0',
      escopo:'Documentos gerais de DP, ferias, banco de horas e rotinas trabalhistas',
      evidencias:['Hash SHA-256 do PDF original','Hash SHA-256 do PDF assinado','Manifesto JSON embutido no PDF','Data e hora da assinatura','IP publico quando disponivel','User-agent e dados tecnicos do dispositivo','Aceite LGPD','Aceite de assinatura','Posicao visual da assinatura no PDF'],
      aviso:'Considere sempre ICP-Brasil ou gov.br para documentos de maior risco, quitacao, renuncia, transacao, exigencia sindical, fe publica ou necessidade de prova reforcada.',
      fundamentoLegal:'MP 2.200-2/2001, art. 10, paragr. 2; Lei 14.063/2020; LGPD 13.709/2018, art. 7, II, V e VI'
    }),
    cores: Object.freeze({
      primary:[0,.514,.792], primaryDark:[0,.235,.392], text:[.2,.2,.2],
      muted:[.4,.4,.4], lightBg:[.96,.97,.98], lgpd:[.29,.078,.549]
    }),
    ipifyUrl: 'https://api.ipify.org?format=json',
    ipifyTimeoutMs: 3000,
    pdfjsWorker: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
    pdfRenderScale: 1.2,
    lgpdTextoCompleto: 'Esta ferramenta de assinatura eletronica realiza tratamento dos seguintes dados pessoais do signatario: nome completo, CPF, numero de celular, e-mail, cargo, endereco IP publico, dados tecnicos do dispositivo (user-agent do navegador, sistema operacional, resolucao de tela, fuso horario e idioma) e imagem da assinatura digitalizada gerada a partir do texto digitado. A finalidade do tratamento e exclusivamente a formalizacao eletronica do documento anexado, com producao de prova de autoria e integridade. As bases legais aplicaveis sao as previstas no art. 7 da Lei 13.709/2018 (LGPD), incisos II (cumprimento de obrigacao legal e regulatoria), V (execucao de contrato do qual o titular e parte) e VI (exercicio regular de direitos em processo judicial, administrativo ou arbitral). Os dados sao embutidos nos metadados do proprio PDF assinado e na pagina visual de assinatura, ficando sob guarda do signatario, do empregador e de terceiros legitimos a quem o documento for apresentado. O historico local em localStorage permanece apenas neste navegador, podendo ser apagado pelo titular a qualquer momento na opcao Apagar historico. O signatario possui os direitos previstos no art. 18 da LGPD: confirmacao da existencia de tratamento, acesso, correcao, anonimizacao, portabilidade e eliminacao dos dados, observadas as excecoes legais, em especial a guarda do PDF assinado durante o prazo prescricional trabalhista (cinco anos durante o contrato e dois anos apos a rescisao, art. 7, XXIX, CF/88). Para exercer qualquer direito, contate o Encarregado pelo Tratamento de Dados (DPO) da organizacao empregadora.'
  });

  /* ===== ESTADO ===== */
  const state = Object.seal({
    pdfBuffer: null, pdfName: null, pdfSize: null, pdfHashOriginal: null,
    signatureDataUrl: null, selectedFont: CONFIG.fontsEnum[0], ip: null,
    pdfJsDoc: null, currentPage: 0, totalPages: 0, pageViewport: null,
    sigPosition: null
  });
  const stateMutator = function(k, v) { if (!(k in state)) throw new Error('estado'); state[k] = v; };
  const stateReader = function(k) { return state[k]; };

  /* ===== HELPERS ===== */
  const helpers = Object.freeze({
    escapeHtml: function(s){return String(s==null?'':s).replace(/[&<>"'/]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','/':'&#x2F;'}[c]});},
    truncar: function(s,n){if(!s)return '';const str=String(s);return str.length>n?str.slice(0,n-3)+'...':str;},
    formatarTamanho: function(b){if(b<1024)return b+' B';if(b<1048576)return (b/1024).toFixed(1)+' KB';return (b/1048576).toFixed(2)+' MB';},
    mascararCPF: function(c){const n=String(c).replace(/\D/g,'');if(n.length!==11)return c;return n.slice(0,3)+'.'+n.slice(3,6)+'.***-'+n.slice(9);},
    mascararCelular: function(c){const n=String(c).replace(/\D/g,'');if(n.length===11)return '('+n.slice(0,2)+') '+n.slice(2,7)+'-'+n.slice(7);if(n.length===10)return '('+n.slice(0,2)+') '+n.slice(2,6)+'-'+n.slice(6);return c;},
    quebrarTexto: function(t,m){const p=String(t).split(/\s+/);const l=[];let a='';for(let i=0;i<p.length;i++){if((a+' '+p[i]).trim().length>m){if(a)l.push(a);a=p[i];}else{a=(a+' '+p[i]).trim();}}if(a)l.push(a);return l;},
    formatarDataExtenso: function(d){const x=d instanceof Date?d:new Date(d);return x.toLocaleDateString('pt-BR')+' '+x.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});}
  });

  /* ===== VALIDADORES ===== */
  const validators = Object.freeze({
    cpf: function(s){const c=String(s).replace(/\D/g,'');if(c.length!==11||/^(\d)\1+$/.test(c))return false;let so=0;for(let i=0;i<9;i++)so+=parseInt(c[i],10)*(10-i);let d1=(so*10)%11;if(d1===10)d1=0;if(d1!==parseInt(c[9],10))return false;so=0;for(let i=0;i<10;i++)so+=parseInt(c[i],10)*(11-i);let d2=(so*10)%11;if(d2===10)d2=0;return d2===parseInt(c[10],10);},
    celular: function(s){const n=String(s).replace(/\D/g,'');if(n.length!==10&&n.length!==11)return false;const d=parseInt(n.slice(0,2),10);if(d<11||d>99)return false;if(n.length===11&&n[2]!=='9')return false;return true;},
    email: function(s){if(!s)return true;return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s)&&s.length<=CONFIG.maxEmailLen;},
    nome: function(s){const n=String(s).trim();return n.length>=3&&n.length<=CONFIG.maxNomeLen&&/\s/.test(n)&&!/\d/.test(n);},
    pdfMagicBytes: function(b){if(!b||b.byteLength<5)return false;const v=new Uint8Array(b,0,5);for(let i=0;i<5;i++)if(v[i]!==CONFIG.pdfMagic[i])return false;return true;}
  });

  /* ===== CRIPTO ===== */
  const cryptoUtils = (function(subtle){
    return Object.freeze({
      hashBuffer: async function(b){const h=await subtle.digest('SHA-256',b);return Array.from(new Uint8Array(h)).map(function(x){return x.toString(16).padStart(2,'0');}).join('');},
      hashText: async function(t){const e=new TextEncoder().encode(String(t));const h=await subtle.digest('SHA-256',e);return Array.from(new Uint8Array(h)).map(function(x){return x.toString(16).padStart(2,'0');}).join('');}
    });
  })(cryptoApi.subtle);

  /* ===== BINARY ===== */
  const binaryUtils = Object.freeze({
    dataURLtoBytes: function(d){const i=String(d).indexOf(',');if(i<0)throw new Error('DataURL invalida');const b=atob(d.slice(i+1));const a=new Uint8Array(b.length);for(let j=0;j<b.length;j++)a[j]=b.charCodeAt(j);return a;},
    bytesToBase64Utf8: function(s){return btoa(unescape(encodeURIComponent(String(s))));},
    downloadBytes: function(b,n,m){const bl=new Blob([b],{type:m});const u=URL.createObjectURL(bl);const a=doc.createElement('a');a.href=u;a.download=n;a.rel='noopener noreferrer';doc.body.appendChild(a);a.click();doc.body.removeChild(a);setTimeout(function(){URL.revokeObjectURL(u);},1500);}
  });

  /* ===== ID ===== */
  const gerarIdAssinatura = (function(rng){
    return function(){const a=new Uint8Array(6);rng(a);const r=Array.from(a).map(function(b){return b.toString(16).padStart(2,'0');}).join('').toUpperCase();return 'SIG-'+Date.now().toString(36).toUpperCase()+'-'+r.slice(0,8);};
  })(cryptoApi.getRandomValues.bind(cryptoApi));

  /* ===== IP ===== */
  const obterIP = (function(tm,url){
    return async function(){
      try{const ctrl=new AbortController();const tid=setTimeout(function(){ctrl.abort();},tm);const r=await fetch(url,{signal:ctrl.signal,referrerPolicy:'no-referrer',cache:'no-store'});clearTimeout(tid);if(!r.ok)return 'N/D';const j=await r.json();const ip=String(j.ip||'');if(/^(\d{1,3}\.){3}\d{1,3}$/.test(ip))return ip;if(/^[0-9a-fA-F:]+$/.test(ip)&&ip.indexOf(':')>=0)return ip;return 'N/D';}catch(e){return 'N/D';}
    };
  })(CONFIG.ipifyTimeoutMs, CONFIG.ipifyUrl);

  /* ===== QR ===== */
  const qrGen = (function(qr){
    return function(t,sz){const q=qr(0,'M');q.addData(String(t));q.make();const mc=q.getModuleCount();const cs=Math.floor(sz/mc);const mg=Math.floor((sz-cs*mc)/2);const c=doc.createElement('canvas');c.width=sz;c.height=sz;const x=c.getContext('2d');x.fillStyle='#FFFFFF';x.fillRect(0,0,sz,sz);x.fillStyle='#000000';for(let r=0;r<mc;r++)for(let cc=0;cc<mc;cc++)if(q.isDark(r,cc))x.fillRect(mg+cc*cs,mg+r*cs,cs,cs);return c.toDataURL('image/png');};
  })(qrcodeRef);

  /* ===== CANVAS DE ASSINATURA ===== */
  const sigCanvas = doc.getElementById('signature-canvas');
  const sigCtx = sigCanvas.getContext('2d');

  function setupSigCanvas(){
    const dpr=globalScope.devicePixelRatio||1;
    const r=sigCanvas.getBoundingClientRect();
    // Garante dimensao minima — canvas em secao colapsada retorna 0
    var w=Math.floor(r.width*dpr)||Math.floor(320*dpr);
    var h=Math.floor(r.height*dpr)||Math.floor(100*dpr);
    sigCanvas.width=w;
    sigCanvas.height=h;
    sigCtx.setTransform(1,0,0,1,0,0);
    sigCtx.scale(dpr,dpr);
  }
  async function renderTextSignature(){
    const texto=doc.getElementById('sig-text').value.trim().slice(0,CONFIG.maxSigTextLen);
    const fonte=stateReader('selectedFont');
    if(!texto){stateMutator('signatureDataUrl',null);atualizarOverlay();atualizarBotaoAssinar();return;}

    // Se canvas nao tem dimensao (secao estava oculta), usar offscreen canvas
    var renderW=sigCanvas.getBoundingClientRect().width||320;
    var renderH=sigCanvas.getBoundingClientRect().height||100;
    var dpr=globalScope.devicePixelRatio||1;
    var needsSetup=(sigCanvas.width<4||sigCanvas.height<4);
    if(needsSetup){
      sigCanvas.width=Math.floor(renderW*dpr);
      sigCanvas.height=Math.floor(renderH*dpr);
      sigCtx.setTransform(1,0,0,1,0,0);
      sigCtx.scale(dpr,dpr);
    }

    // Usar canvas offscreen para garantir PNG valido independente de visibilidade
    var oc=doc.createElement('canvas');
    oc.width=sigCanvas.width||Math.floor(renderW*dpr);
    oc.height=sigCanvas.height||Math.floor(renderH*dpr);
    var octx=oc.getContext('2d');
    var cw=oc.width/dpr;
    var ch=oc.height/dpr;
    octx.scale(dpr,dpr);
    octx.clearRect(0,0,cw,ch);

    try{await doc.fonts.load('48px "'+fonte+'"');}catch(e){}
    var fs=48;
    octx.fillStyle='#003C64';
    octx.textBaseline='middle';
    octx.textAlign='center';
    do{octx.font=fs+'px "'+fonte+'", cursive';var tw=octx.measureText(texto).width;if(tw<cw-40)break;fs-=2;}while(fs>18);
    octx.fillText(texto,cw/2,ch/2-6);

    // Copiar para o canvas visivel tambem
    sigCtx.clearRect(0,0,cw,ch);
    sigCtx.drawImage(oc,0,0,cw,ch,0,0,cw,ch);

    var dataUrl=oc.toDataURL('image/png');
    // Validar que o dataURL e realmente um PNG (começa com iVBORw0KGgo)
    var b64part=dataUrl.split(',')[1]||'';
    if(b64part.length<20){
      // Canvas em branco ou falhou — nao atualizar signatureDataUrl
      return;
    }
    stateMutator('signatureDataUrl',dataUrl);
    atualizarOverlay();
    atualizarBotaoAssinar();
    atualizarProgressBar();
  }

  /* ===== MINIATURA DO PDF (thumb) ===== */
  async function renderizarMiniatura(){
    const d=stateReader('pdfJsDoc');
    if(!d)return;
    try{
      const page=await d.getPage(1);
      const vp=page.getViewport({scale:0.4});
      const thumbCanvas=doc.getElementById('pdf-thumb-canvas');
      const ctx=thumbCanvas.getContext('2d');
      thumbCanvas.width=vp.width;
      thumbCanvas.height=vp.height;
      thumbCanvas.style.maxWidth='100%';
      thumbCanvas.style.height='auto';
      await page.render({canvasContext:ctx,viewport:vp}).promise;
      const wrap=doc.getElementById('pdf-thumb-wrap');
      wrap.classList.add('show');
      doc.getElementById('pdf-thumb-label').textContent='Pagina 1 de '+d.numPages+' - toque para posicionar';
    }catch(e){}
  }

  /* ===== POSICIONADOR DOCUSIGN-STYLE ===== */
  pdfjsRef.GlobalWorkerOptions.workerSrc = CONFIG.pdfjsWorker;
  const pdfCanvas = doc.getElementById('pdf-canvas');
  const pdfCtx = pdfCanvas.getContext('2d');
  const overlay = doc.getElementById('sig-overlay');
  const overlayImg = doc.getElementById('sig-overlay-img');
  const resizeHandle = doc.getElementById('resize-handle');
  const tapLayer = doc.getElementById('ds-tap-layer');

  // Atualiza o chip de instrucao do posicionador
  function atualizarChipPos(temAssinatura){
    const chip=doc.getElementById('pos-chip');
    const icon=doc.getElementById('pos-chip-icon');
    const txt=doc.getElementById('pos-chip-txt');
    const toolbar=doc.getElementById('pos-toolbar');
    const chipsAcao=doc.getElementById('pos-chips-acao');
    const pageNav=doc.getElementById('ds-page-nav');
    if(temAssinatura){
      chip.className='pos-chip pos-chip-done';
      icon.textContent='\u2714';
      txt.textContent='Assinatura posicionada. Arraste para ajustar.';
      if(toolbar)toolbar.style.display='block';
      if(chipsAcao)chipsAcao.style.display='flex';
      if(pageNav)pageNav.style.display='flex';
      tapLayer.classList.add('hidden');
    }else{
      chip.className='pos-chip pos-chip-tap';
      icon.textContent='\u270E';
      txt.textContent='Toque no documento onde quer assinar';
      if(toolbar)toolbar.style.display='none';
      if(chipsAcao)chipsAcao.style.display='none';
      if(pageNav)pageNav.style.display='none';
      tapLayer.classList.remove('hidden');
    }
  }

  async function carregarPdfJs(){
    if(!stateReader('pdfBuffer'))return;
    try{
      const copy=stateReader('pdfBuffer').slice(0);
      const task=pdfjsRef.getDocument({data:copy});
      const doc2=await task.promise;
      stateMutator('pdfJsDoc',doc2);
      stateMutator('totalPages',doc2.numPages);
      stateMutator('currentPage',doc2.numPages-1);
      // SEM pre-posicionar — usuario vai tocar para escolher
      stateMutator('sigPosition',null);
      // Atualiza totais nas duas navs
      doc.getElementById('page-total').textContent=doc2.numPages;
      doc.getElementById('page-total-2').textContent=doc2.numPages;
      doc.getElementById('pos-placeholder').style.display='none';
      doc.getElementById('pos-area').style.display='block';
      atualizarChipPos(false);
      await renderizarPagina(doc2.numPages-1);
      await renderizarMiniatura();
    }catch(e){
      mostrarStatus('Erro ao carregar PDF para visualizacao: '+e.message,'error');
    }
  }

  async function renderizarPagina(idx){
    const d=stateReader('pdfJsDoc');
    if(!d)return;
    const page=await d.getPage(idx+1);
    const rawVp=page.getViewport({scale:1});
    // Largura maxima disponivel no viewer
    const viewerEl=doc.getElementById('ds-viewer');
    const containerW=viewerEl ? Math.min(viewerEl.clientWidth-32, 580) : Math.min(globalScope.innerWidth-60, 580);
    const scale=Math.max(0.5,Math.min(containerW/rawVp.width, 2.0));
    const viewport=page.getViewport({scale:scale});
    pdfCanvas.width=viewport.width;
    pdfCanvas.height=viewport.height;
    pdfCanvas.style.width=viewport.width+'px';
    pdfCanvas.style.height=viewport.height+'px';
    await page.render({canvasContext:pdfCtx,viewport:viewport}).promise;
    stateMutator('currentPage',idx);
    stateMutator('pageViewport',{width:viewport.width,height:viewport.height,rawWidth:rawVp.width,scale:scale});
    // Atualiza ambas as navs
    doc.getElementById('page-current').textContent=idx+1;
    doc.getElementById('page-current-2').textContent=idx+1;
    const atFirst=(idx<=0);
    const atLast=(idx>=stateReader('totalPages')-1);
    doc.getElementById('page-prev').disabled=atFirst;
    doc.getElementById('page-next').disabled=atLast;
    doc.getElementById('ds-prev').disabled=atFirst;
    doc.getElementById('ds-next').disabled=atLast;
    const pos=stateReader('sigPosition');
    if(pos)stateMutator('sigPosition',Object.assign({},pos,{widthRatio:pos.widthRatio||0.28}));
    atualizarOverlay();
  }

  function atualizarOverlay(){
    const sig=stateReader('signatureDataUrl');
    const pos=stateReader('sigPosition');
    const vp=stateReader('pageViewport');
    if(!sig||!pos||!vp){overlay.style.display='none';return;}
    if(pos.pageIdx!==stateReader('currentPage')){overlay.style.display='none';return;}
    overlay.style.display='block';
    overlayImg.src=sig;
    const w=vp.width*pos.widthRatio;
    // aspect ratio do canvas pode ser 0 se ainda nao foi renderizado — usar fallback
    const canvH=sigCanvas.height||1;
    const canvW=sigCanvas.width||1;
    const aspect=canvH/canvW||0.35;
    const h=w*aspect;
    const x=vp.width*pos.xRatio-w/2;
    const y=vp.height*pos.yRatio-h/2;
    overlay.style.left=x+'px';
    overlay.style.top=y+'px';
    overlay.style.width=w+'px';
    overlay.style.height=h+'px';
  }

  // TAP-TO-PLACE: usuario toca no PDF para colocar assinatura
  tapLayer.addEventListener('pointerdown',function(e){
    const sig=stateReader('signatureDataUrl');
    if(!sig){
      // Avisa que precisa gerar assinatura primeiro
      toggleSecao(3);
      return;
    }
    const vp=stateReader('pageViewport');
    if(!vp)return;
    const rect=tapLayer.getBoundingClientRect();
    const x=e.clientX-rect.left;
    const y=e.clientY-rect.top;
    const xRatio=x/vp.width;
    const yRatio=y/vp.height;
    const cur=stateReader('currentPage');
    stateMutator('sigPosition',{pageIdx:cur,xRatio:xRatio,yRatio:yRatio,widthRatio:0.28});
    atualizarOverlay();
    atualizarChipPos(true);
    atualizarBotaoAssinar();
    atualizarProgressBar();
    e.preventDefault();
  });

  // DRAG e RESIZE do overlay (pointer events — touch e mouse)
  let isDragging=false;
  let isResizing=false;
  let dragStartX=0,dragStartY=0,initialX=0,initialY=0,initialW=0;

  overlay.addEventListener('pointerdown',function(e){
    if(e.target===resizeHandle){isResizing=true;}else{isDragging=true;}
    overlay.classList.add('dragging');
    overlay.setPointerCapture(e.pointerId);
    dragStartX=e.clientX;dragStartY=e.clientY;
    const rect=overlay.getBoundingClientRect();
    const containerRect=doc.getElementById('pdf-canvas-container').getBoundingClientRect();
    initialX=rect.left-containerRect.left;
    initialY=rect.top-containerRect.top;
    initialW=rect.width;
    e.preventDefault();
    e.stopPropagation();
  });
  overlay.addEventListener('pointermove',function(e){
    if(!isDragging&&!isResizing)return;
    const vp=stateReader('pageViewport');
    const pos=stateReader('sigPosition');
    if(!vp||!pos)return;
    const dx=e.clientX-dragStartX;
    const dy=e.clientY-dragStartY;
    if(isResizing){
      const newW=Math.max(30,Math.min(vp.width*0.8,initialW+dx));
      const widthRatio=newW/vp.width;
      stateMutator('sigPosition',Object.assign({},pos,{widthRatio:widthRatio}));
      doc.getElementById('sig-size').value=String(widthRatio.toFixed(2));
    }else{
      const canvH=sigCanvas.height||1;
      const canvW=sigCanvas.width||1;
      const aspect=canvH/canvW||0.35;
      const w=vp.width*pos.widthRatio;
      const h=w*aspect;
      let newX=initialX+dx;
      let newY=initialY+dy;
      newX=Math.max(0,Math.min(vp.width-w,newX));
      newY=Math.max(0,Math.min(vp.height-h,newY));
      const xRatio=(newX+w/2)/vp.width;
      const yRatio=(newY+h/2)/vp.height;
      stateMutator('sigPosition',Object.assign({},pos,{xRatio:xRatio,yRatio:yRatio}));
    }
    atualizarOverlay();
  });
  overlay.addEventListener('pointerup',function(e){
    isDragging=false;isResizing=false;
    overlay.classList.remove('dragging');
    try{overlay.releasePointerCapture(e.pointerId);}catch(err){}
    atualizarBotaoAssinar();
    atualizarProgressBar();
  });
  overlay.addEventListener('pointercancel',function(){isDragging=false;isResizing=false;overlay.classList.remove('dragging');});

  /* ===== STATUS ===== */
  function mostrarStatus(msg,tipo){
    const s=doc.getElementById('status');
    s.textContent=String(msg);
    s.className='status show '+tipo;
    if(tipo!=='success')setTimeout(function(){s.classList.remove('show');},7000);
  }

  /* ===== PROGRESSO / SECOES ===== */
  function atualizarProgressBar(){
    const f=lerFormulario();
    const p1=stateReader('pdfBuffer')!==null;
    const p2=validators.nome(f.nome)&&validators.cpf(f.cpf)&&validators.celular(f.celular)&&validators.email(f.email);
    const p3=stateReader('signatureDataUrl')!==null&&f.sigText.length>=2;
    const p4=stateReader('sigPosition')!==null;
    const p5=f.aceiteLgpd&&f.aceiteAssinatura;

    function setStep(id,done,active){
      const el=doc.getElementById('prog-'+id);
      el.classList.remove('done','active');
      const dot=el.querySelector('.prog-dot');
      if(done){el.classList.add('done');dot.textContent='✓';}
      else if(active){el.classList.add('active');dot.textContent=String(id);}
      else{dot.textContent=String(id);}
    }
    setStep(1,p1,!p1);
    setStep(2,p2,p1&&!p2);
    setStep(3,p3,p2&&!p3);
    setStep(4,p4,p3&&!p4);
    setStep(5,p5,p4&&!p5);

    // badges
    const badge=function(id,ok){
      const b=doc.getElementById('badge-'+id);
      b.textContent=ok?'Pronto':'Pendente';
      b.className='section-badge '+(ok?'badge-ok':'badge-pending');
      const sec=doc.getElementById('sec-'+id);
      if(ok)sec.classList.add('done'); else sec.classList.remove('done');
    };
    badge(1,p1);badge(2,p2);badge(3,p3);badge(4,p4);badge(5,p5);

    // texto do botao
    const ptxt=doc.getElementById('btn-progress-txt');
    if(!p1)ptxt.textContent='Passo 1: selecione o PDF';
    else if(!p2)ptxt.textContent='Passo 2: preencha os dados';
    else if(!p3)ptxt.textContent='Passo 3: gere a assinatura';
    else if(!p4)ptxt.textContent='Passo 4: posicione no documento';
    else if(!p5)ptxt.textContent='Passo 5: marque os aceites';
    else ptxt.textContent='Tudo certo. Clique para assinar.';
  }

  /* ===== SECOES COLAPSAVEIS ===== */
  function toggleSecao(id){
    const card=doc.getElementById('sec-'+id);
    const isOpen=card.classList.contains('open');
    // fecha todas
    for(let i=1;i<=5;i++){
      const c=doc.getElementById('sec-'+i);
      c.classList.remove('open','active');
    }
    if(!isOpen){
      card.classList.add('open','active');
      // canvas de assinatura só tem dimensões reais quando visível
      if(id===3){
        requestAnimationFrame(function(){
          setupSigCanvas();
          renderTextSignature();
        });
      }
    }
  }

  /* ===== FORM ===== */

  function lerFormulario(){
    return {
      nome:doc.getElementById('nome').value.trim().slice(0,CONFIG.maxNomeLen),
      cpf:doc.getElementById('cpf').value.trim(),
      celular:doc.getElementById('celular').value.trim(),
      email:doc.getElementById('email').value.trim().slice(0,CONFIG.maxEmailLen),
      cargo:doc.getElementById('cargo').value.trim().slice(0,CONFIG.maxCargoLen),
      sigText:doc.getElementById('sig-text').value.trim().slice(0,CONFIG.maxSigTextLen),
      aceiteLgpd:doc.getElementById('aceite-lgpd').checked,
      aceiteAssinatura:doc.getElementById('aceite-assinatura').checked
    };
  }

  function atualizarBotaoAssinar(){
    const f=lerFormulario();
    const pronto=stateReader('pdfBuffer')!==null
      &&validators.nome(f.nome)&&validators.cpf(f.cpf)&&validators.celular(f.celular)
      &&validators.email(f.email)&&f.sigText.length>=2
      &&stateReader('signatureDataUrl')!==null
      &&stateReader('sigPosition')!==null
      &&f.aceiteLgpd&&f.aceiteAssinatura;
    doc.getElementById('btn-assinar').disabled=!pronto;
    atualizarProgressBar();
  }

  function validarCampoAoSair(id,fn){
    const el=doc.getElementById(id);
    const fieldEl=doc.getElementById('field-'+id);
    if(!fieldEl)return;
    if(el.value.trim().length===0)return; // nao valida campo vazio ao sair
    if(fn(el.value)){
      el.classList.remove('error');el.classList.add('valid');
      fieldEl.classList.remove('has-error');
    }else{
      el.classList.add('error');el.classList.remove('valid');
      fieldEl.classList.add('has-error');
    }
  }

  function mascararCpfInput(e){
    let v=e.target.value.replace(/\D/g,'').slice(0,11);
    v=v.replace(/(\d{3})(\d)/,'$1.$2').replace(/(\d{3})(\d)/,'$1.$2').replace(/(\d{3})(\d{1,2})$/,'$1-$2');
    e.target.value=v;
    atualizarBotaoAssinar();
  }
  function mascararCelularInput(e){
    let v=e.target.value.replace(/\D/g,'').slice(0,11);
    if(v.length>10)v=v.replace(/(\d{2})(\d{5})(\d{0,4})/,'($1) $2-$3').replace(/-$/,'');
    else if(v.length>6)v=v.replace(/(\d{2})(\d{4})(\d{0,4})/,'($1) $2-$3').replace(/-$/,'');
    else if(v.length>2)v=v.replace(/(\d{2})(\d{0,5})/,'($1) $2').replace(/ $/,'');
    else if(v.length>0)v='('+v;
    e.target.value=v;
    atualizarBotaoAssinar();
  }

  /* ===== UPLOAD ===== */
  const handlePdfUpload = (function(validatePdf, hashFn, sizeFn){
    return async function(file){
      if(!file)return;
      if(file.type!=='application/pdf')return mostrarStatus('Arquivo invalido. Selecione um PDF.','error');
      if(file.size>CONFIG.maxFileSize)return mostrarStatus('Arquivo excede o limite de 20 MB.','error');
      try{
        const buffer=await file.arrayBuffer();
        if(!validatePdf(buffer))return mostrarStatus('O arquivo nao e um PDF valido (assinatura binaria ausente).','error');
        const hash=await hashFn(buffer);
        stateMutator('pdfBuffer',buffer);
        stateMutator('pdfName',String(file.name).slice(0,200));
        stateMutator('pdfSize',file.size);
        stateMutator('pdfHashOriginal',hash);
        const dz=doc.getElementById('dropzone');
        const dzInner=dz.querySelector('strong');
        const dzSpan=dz.querySelector('span');
        dz.classList.add('has-file');
        if(dzInner)dzInner.textContent=file.name;
        if(dzSpan)dzSpan.textContent=sizeFn(file.size)+' - toque para trocar';
        const info=doc.getElementById('pdf-info');
        info.style.display='block';
        info.innerHTML='';
        const lb=doc.createElement('span');lb.textContent='SHA-256: ';
        const cd=doc.createElement('span');cd.className='hash-preview';cd.textContent=hash;
        info.appendChild(lb);info.appendChild(cd);
        atualizarBotaoAssinar();
        // auto-avanca para passo 2 se ainda nao preencheu
        const f=lerFormulario();
        if(!validators.nome(f.nome)){
          setTimeout(function(){toggleSecao(2);},400);
        }
        await carregarPdfJs();
      }catch(err){mostrarStatus('Erro ao processar PDF: '+err.message,'error');}
    };
  })(validators.pdfMagicBytes, cryptoUtils.hashBuffer, helpers.formatarTamanho);

  /* ===== CONSTRUIR PDF ASSINADO ===== */
  const construirPDFAssinado = (function(libs){
    const pdfLib=libs.pdfLib, dataURLtoBytes=libs.dataURLtoBytes, qrFn=libs.qrFn;
    const trunc=libs.trunc, quebrar=libs.quebrar, fmtData=libs.fmtData, b64Utf8=libs.b64Utf8;

    return async function(manifesto){
      const PDFDocument=pdfLib.PDFDocument, rgb=pdfLib.rgb, StandardFonts=pdfLib.StandardFonts;
      const pdfDoc=await PDFDocument.load(stateReader('pdfBuffer'));
      const helv=await pdfDoc.embedFont(StandardFonts.Helvetica);
      const helvBold=await pdfDoc.embedFont(StandardFonts.HelveticaBold);
      const helvOblique=await pdfDoc.embedFont(StandardFonts.HelveticaOblique);

      const sigDataUrl=stateReader('signatureDataUrl');
      if(!sigDataUrl||sigDataUrl.indexOf('data:image/png;base64,')<0){
        throw new Error('Assinatura nao gerada corretamente. Abra o passo 3, digite o nome e aguarde a previa aparecer antes de assinar.');
      }
      var sigB64=sigDataUrl.split(',')[1]||'';
      if(sigB64.length<20){
        throw new Error('Imagem da assinatura invalida (muito pequena). Abra o passo 3 e redigite o nome da assinatura.');
      }
      const sigBytes=dataURLtoBytes(sigDataUrl);
      const sigImage=await pdfDoc.embedPng(sigBytes);

      // Sanitiza texto para WinAnsi (Helvetica padrao nao suporta acentos)
      function s(t){
        if(t==null)return '';
        return String(t).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^\x20-\x7E]/g,'?');
      }

      // Assinatura visual na pagina escolhida
      const sigPos=stateReader('sigPosition');
      if(sigPos){
        const allPages=pdfDoc.getPages();
        const targetIdx=sigPos.pageIdx;
        if(targetIdx>=0&&targetIdx<allPages.length){
          const tp=allPages[targetIdx];
          const ps=tp.getSize();
          const sigW=ps.width*sigPos.widthRatio;
          const sigH=sigW*(sigImage.height/sigImage.width);
          const pdfX=ps.width*sigPos.xRatio-sigW/2;
          const pdfY=ps.height*(1-sigPos.yRatio)-sigH/2;
          tp.drawImage(sigImage,{x:pdfX,y:pdfY,width:sigW,height:sigH});
        }
      }

      // Pagina de CERTIFICADO como PRIMEIRA pagina
      const page=pdfDoc.insertPage(0,[595.28,841.89]);
      const sz=page.getSize();
      const width=sz.width, height=sz.height;
      const c=CONFIG.cores;
      const primary=rgb(c.primary[0],c.primary[1],c.primary[2]);
      const primaryDark=rgb(c.primaryDark[0],c.primaryDark[1],c.primaryDark[2]);
      const textColor=rgb(c.text[0],c.text[1],c.text[2]);
      const muted=rgb(c.muted[0],c.muted[1],c.muted[2]);
      const lightBg=rgb(c.lightBg[0],c.lightBg[1],c.lightBg[2]);
      const white=rgb(1,1,1);
      const lgpdColor=rgb(c.lgpd[0],c.lgpd[1],c.lgpd[2]);

      page.drawRectangle({x:0,y:height-70,width:width,height:70,color:primary});
      page.drawText('CERTIFICADO DE ASSINATURA ELETRONICA',{x:40,y:height-38,size:16,font:helvBold,color:white});
      page.drawText('Documento particular assinado com evidencias tecnicas de autoria e integridade',{x:40,y:height-58,size:8.5,font:helv,color:white});

      page.drawRectangle({x:width-165,y:height-220,width:130,height:80,borderColor:primary,borderWidth:2,color:white});
      page.drawText('ASSINADO',{x:width-156,y:height-175,size:16,font:helvBold,color:primary});
      page.drawText('ELETRONICAMENTE',{x:width-156,y:height-192,size:8,font:helvBold,color:primary});
      page.drawText(fmtData(new Date(manifesto.timestampISO)),{x:width-156,y:height-208,size:7,font:helv,color:muted});

      let y=height-110;
      page.drawText('DADOS DO SIGNATARIO E CLASSIFICACAO DP',{x:40,y:y,size:10,font:helvBold,color:primaryDark});
      y-=6;page.drawLine({start:{x:40,y:y},end:{x:width-180,y:y},color:primary,thickness:1.5});y-=18;
      const campos=[
        ['Nome:',s(manifesto.signatario.nome)],
        ['CPF:',s(manifesto.signatario.cpf)],
        ['Celular:',s(manifesto.signatario.celular)],
        ['Cargo:',s(manifesto.signatario.cargo||'-')],
        ['E-mail:',s(manifesto.signatario.email||'-')],
        ['Trilha de seguranca:',s((manifesto.seguranca&&manifesto.seguranca.versao)||'TRILHA-SEGURANCA-DP')],
        ['Aviso:',s((manifesto.seguranca&&manifesto.seguranca.aviso)||'Considere ICP-Brasil ou gov.br para documentos de maior risco.')]
      ];
      for(let i=0;i<campos.length;i++){
        page.drawText(campos[i][0],{x:40,y:y,size:9,font:helvBold,color:muted});
        page.drawText(String(campos[i][1]),{x:110,y:y,size:10,font:helv,color:textColor});
        y-=16;
      }

      y-=8;page.drawText('ASSINATURA DIGITALIZADA',{x:40,y:y,size:9,font:helvBold,color:muted});y-=6;
      const sigW2=260;const sigH2=(sigImage.height/sigImage.width)*sigW2;
      page.drawRectangle({x:40,y:y-sigH2-8,width:sigW2+16,height:sigH2+16,color:lightBg,borderColor:rgb(.85,.85,.85),borderWidth:.5});
      page.drawImage(sigImage,{x:48,y:y-sigH2,width:sigW2,height:sigH2});
      page.drawLine({start:{x:48,y:y-sigH2-2},end:{x:48+sigW2,y:y-sigH2-2},color:rgb(.5,.5,.5),thickness:.5});
      y-=sigH2+28;

      page.drawText('EVIDENCIAS TECNICAS DA ASSINATURA',{x:40,y:y,size:10,font:helvBold,color:primaryDark});
      y-=6;page.drawLine({start:{x:40,y:y},end:{x:width-40,y:y},color:primary,thickness:1.5});y-=18;
      const evid=[
        ['ID da assinatura:',manifesto.idAssinatura],
        ['Data e hora:',manifesto.timestampLocal+' ('+manifesto.evidencias.fusoHorario+')'],
        ['Endereco IP:',manifesto.evidencias.ip],
        ['Dispositivo:',s(trunc(manifesto.evidencias.userAgent,75))],
        ['Resolucao:',manifesto.evidencias.resolucaoTela],
        ['Estilo de assinatura:',manifesto.signatario.estiloAssinatura],
        ['Posicao (pagina):',String(manifesto.signatario.posicaoPagina)]
      ];
      for(let i=0;i<evid.length;i++){
        page.drawText(evid[i][0],{x:40,y:y,size:8.5,font:helvBold,color:muted});
        page.drawText(String(evid[i][1]),{x:200,y:y,size:9,font:helv,color:textColor});
        y-=14;
      }
      page.drawText('Hash SHA-256 do documento original:',{x:40,y:y,size:8.5,font:helvBold,color:muted});y-=12;
      page.drawText(s(manifesto.documento.hashSHA256Original),{x:40,y:y,size:7.5,font:helv,color:textColor});y-=16;
      page.drawText(s('Arquivo original: '+trunc(manifesto.documento.nomeOriginal,60)),{x:40,y:y,size:8,font:helvOblique,color:muted});y-=22;

      const baseUrl=globalScope.location.href.replace(/[?#].*$/,'').replace(/\/[^\/]*$/,'/');
      const verifUrl=baseUrl+'verificar.html?id='+encodeURIComponent(manifesto.idAssinatura);
      const qrPng=qrFn(verifUrl,300);
      const qrBytes=dataURLtoBytes(qrPng);
      const qrImage=await pdfDoc.embedPng(qrBytes);
      const qrSize=90;
      page.drawImage(qrImage,{x:width-qrSize-40,y:110,width:qrSize,height:qrSize});
      page.drawText('Verifique este documento:',{x:width-qrSize-40,y:102,size:7.5,font:helvBold,color:muted});
      page.drawText('Aponte a camera ou acesse',{x:width-qrSize-40,y:92,size:7,font:helv,color:muted});
      page.drawText(s(trunc(verifUrl,40)),{x:width-qrSize-40,y:82,size:6.5,font:helv,color:primary});

      page.drawText('TRATAMENTO DE DADOS PESSOAIS (LGPD)',{x:40,y:y,size:9,font:helvBold,color:lgpdColor});y-=12;
      const lgpdResumo='Signatario autorizou o tratamento dos dados pessoais aqui registrados, nos termos da Lei 13.709/2018, art. 7, incisos II, V e VI, para fins de formalizacao eletronica do documento.';
      const linhasLgpd=quebrar(lgpdResumo,95);
      for(let i=0;i<linhasLgpd.length;i++){page.drawText(linhasLgpd[i],{x:40,y:y,size:7.5,font:helv,color:textColor});y-=10;}
      y-=6;page.drawText('TERMO DE ACEITE CONFIRMADO',{x:40,y:y,size:9,font:helvBold,color:primaryDark});y-=12;
      const aceiteResumo='Signatario declarou ciencia integral do conteudo do documento, confirmou sua identificacao, aceitou a assinatura eletronica com evidencias de autoria e integridade e concordou com a classificacao documental indicada para uso no DP.';
      const linhasAceite=quebrar(aceiteResumo,95);
      for(let i=0;i<linhasAceite.length;i++){page.drawText(linhasAceite[i],{x:40,y:y,size:7.5,font:helv,color:textColor});y-=10;}

      page.drawRectangle({x:0,y:0,width:width,height:35,color:primaryDark});
      page.drawText('Fundamento: MP 2.200-2/2001, art. 10, paragr.2 - Lei 14.063/2020 - LGPD 13.709/2018',{x:40,y:19,size:8,font:helv,color:white});
      page.drawText('Assinatura eletronica com trilha de seguranca - Considere ICP-Brasil ou gov.br para maior risco',{x:40,y:8,size:7,font:helvOblique,color:rgb(.85,.85,.85)});

      pdfDoc.setTitle(s('Documento Assinado Eletronicamente - '+manifesto.signatario.nome));
      pdfDoc.setSubject('Assinatura eletronica com evidencias DP - ID '+manifesto.idAssinatura);
      pdfDoc.setAuthor(s(manifesto.signatario.nome));
      pdfDoc.setProducer('Assinador Eletronico v'+CONFIG.versao);
      pdfDoc.setCreator('Assinador Eletronico v'+CONFIG.versao);
      pdfDoc.setKeywords([
        'ASSINATURA_ELETRONICA',
        'ID:'+manifesto.idAssinatura,
        'HASH_ORIGINAL:'+manifesto.documento.hashSHA256Original,
        'CARIMBO_POSICAO:0',
        'TRILHA_SEGURANCA:'+(((manifesto.seguranca||{}).versao)||'TRILHA-SEGURANCA-DP'),
        'MANIFESTO_B64:'+b64Utf8(JSON.stringify(manifesto))
      ]);
      return await pdfDoc.save();
    };
  })({
    pdfLib:pdfLibRef, dataURLtoBytes:binaryUtils.dataURLtoBytes, qrFn:qrGen,
    trunc:helpers.truncar, quebrar:helpers.quebrarTexto,
    fmtData:helpers.formatarDataExtenso, b64Utf8:binaryUtils.bytesToBase64Utf8
  });

  /* ===== EXECUTAR ASSINATURA ===== */
  const executarAssinatura = (function(deps){
    const hashText=deps.hashText, hashBuffer=deps.hashBuffer, getIp=deps.getIp;
    const newId=deps.newId, builder=deps.builder, downloader=deps.downloader;
    return async function(){
      const btn=doc.getElementById('btn-assinar');
      btn.disabled=true;
      mostrarStatus('Processando assinatura...','info');
      try{
        const f=lerFormulario();
        if(!stateReader('pdfBuffer'))throw new Error('Nenhum PDF carregado.');
        if(!validators.nome(f.nome))throw new Error('Nome invalido. Informe nome completo.');
        if(!validators.cpf(f.cpf))throw new Error('CPF invalido.');
        if(!validators.celular(f.celular))throw new Error('Celular invalido.');
        if(!validators.email(f.email))throw new Error('E-mail em formato invalido.');
        if(f.sigText.length<2)throw new Error('Digite o nome para gerar a assinatura.');
        if(!stateReader('signatureDataUrl'))throw new Error('Assinatura nao foi gerada.');
        if(!stateReader('sigPosition'))throw new Error('Posicione a assinatura no documento.');
        if(!f.aceiteLgpd)throw new Error('E necessario autorizar o tratamento de dados (LGPD).');
        if(!f.aceiteAssinatura)throw new Error('E necessario aceitar o termo de assinatura.');

        const cpfNumeros=f.cpf.replace(/\D/g,'');
        const celularNumeros=f.celular.replace(/\D/g,'');
        const ip=await getIp();stateMutator('ip',ip);
        const agora=new Date();
        const idAssinatura=newId();
        const userAgent=String(navigator.userAgent||'N/D').slice(0,250);
        const fusoHorario=Intl.DateTimeFormat().resolvedOptions().timeZone||'N/D';
        const sigPos=stateReader('sigPosition');
        const manifesto={
          versao:CONFIG.versao,
          idAssinatura:idAssinatura,
          timestampISO:agora.toISOString(),
          timestampLocal:agora.toLocaleString('pt-BR'),
          documento:{
            nomeOriginal:stateReader('pdfName'),
            tamanhoBytes:stateReader('pdfSize'),
            hashSHA256Original:stateReader('pdfHashOriginal')
          },
          seguranca:Object.assign({},CONFIG.trilhaSegurancaPadrao),
          signatario:{
            nome:f.nome,
            cpf:helpers.mascararCPF(cpfNumeros),
            cpfHashSHA256:await hashText(cpfNumeros),
            celular:helpers.mascararCelular(celularNumeros),
            email:f.email||null,
            cargo:f.cargo||null,
            estiloAssinatura:stateReader('selectedFont'),
            textoAssinatura:f.sigText,
            posicaoPagina:sigPos.pageIdx+1,
            posicaoCoordenadas:{xRatio:sigPos.xRatio,yRatio:sigPos.yRatio,widthRatio:sigPos.widthRatio}
          },
          evidencias:{
            ip:ip,
            userAgent:userAgent,
            idioma:navigator.language||'N/D',
            fusoHorario:fusoHorario,
            resolucaoTela:screen.width+'x'+screen.height,
            cookieEnabled:navigator.cookieEnabled===true
          },
          aceite:{
            confirmadoAssinatura:true,
            confirmadoLgpd:true,
            confirmouLeituraDocumento:true,
            timestampAceite:agora.toISOString(),
            textoAssinatura:'Li, compreendi, conferi o documento e assino voluntariamente. Confirmo ser a pessoa identificada.',
            fundamentoLegal:'MP 2.200-2/2001, art. 10, paragr.2; Lei 14.063/2020; LGPD 13.709/2018, art. 7, II, V, VI',
            observacaoJuridica:'Assinatura eletronica com evidencias de autoria, integridade e trilha de seguranca. Considere sempre ICP-Brasil ou gov.br para documentos de maior risco.'
          }
        };

        const pdfBytes=await builder(manifesto);
        manifesto.documento.hashSHA256Assinado=await hashBuffer(pdfBytes.buffer);
        salvarHistorico(manifesto);
        const nomeArq=String(stateReader('pdfName')).replace(/\.pdf$/i,'')+'_ASSINADO.pdf';
        downloader(pdfBytes,nomeArq,'application/pdf');
        mostrarStatus('Documento assinado com sucesso. Arquivo baixado: '+nomeArq,'success');
        // scroll para o status
        doc.getElementById('status').scrollIntoView({behavior:'smooth',block:'center'});
      }catch(err){
        mostrarStatus('Erro: '+(err&&err.message?err.message:'falha desconhecida'),'error');
        doc.getElementById('status').scrollIntoView({behavior:'smooth',block:'center'});
        console.error(err);
      }finally{atualizarBotaoAssinar();}
    };
  })({
    hashText:cryptoUtils.hashText, hashBuffer:cryptoUtils.hashBuffer,
    getIp:obterIP, newId:gerarIdAssinatura, builder:construirPDFAssinado,
    downloader:binaryUtils.downloadBytes
  });

  /* ===== HISTORICO ===== */
  function salvarHistorico(m){
    try{
      const raw=localStorage.getItem(CONFIG.storageKey)||'[]';
      const p=JSON.parse(raw);const lista=Array.isArray(p)?p:[];
      lista.unshift({id:m.idAssinatura,nome:m.signatario.nome,cpf:m.signatario.cpf,celular:m.signatario.celular,documento:m.documento.nomeOriginal,tipo:'Documento geral DP',risco:'Conforme conteudo do documento',timestamp:m.timestampISO,hash:m.documento.hashSHA256Original});
      if(lista.length>200)lista.length=200;
      localStorage.setItem(CONFIG.storageKey,JSON.stringify(lista));
    }catch(e){console.warn('hist:',e);}
  }
  function abrirHistorico(){
    let lista=[];
    try{const raw=localStorage.getItem(CONFIG.storageKey)||'[]';const p=JSON.parse(raw);if(Array.isArray(p))lista=p;}catch(e){}
    const body=doc.getElementById('history-body');body.textContent='';
    if(lista.length===0){
      const e=doc.createElement('div');e.className='empty-history';e.textContent='Nenhuma assinatura registrada neste dispositivo.';body.appendChild(e);
    }else{
      const tb=doc.createElement('table');
      const th=doc.createElement('thead');const tr1=doc.createElement('tr');
      ['Data','Signatario','Documento','ID'].forEach(function(t){const x=doc.createElement('th');x.textContent=t;tr1.appendChild(x);});
      th.appendChild(tr1);tb.appendChild(th);
      const tbd=doc.createElement('tbody');
      for(let i=0;i<lista.length;i++){
        const it=lista[i];const tr=doc.createElement('tr');
        const tdD=doc.createElement('td');tdD.textContent=new Date(it.timestamp).toLocaleString('pt-BR');
        const tdN=doc.createElement('td');tdN.textContent=String(it.nome||'');
        const sm=doc.createElement('small');sm.style.color='var(--muted)';sm.style.display='block';
        sm.textContent=(it.cpf||'')+' - '+(it.celular||'');tdN.appendChild(sm);
        const tdDc=doc.createElement('td');tdDc.textContent=String(it.documento||'-');
        const tdI=doc.createElement('td');const cd=doc.createElement('code');cd.style.fontSize='.7rem';cd.textContent=String(it.id||'');tdI.appendChild(cd);
        tr.appendChild(tdD);tr.appendChild(tdN);tr.appendChild(tdDc);tr.appendChild(tdI);
        tbd.appendChild(tr);
      }
      tb.appendChild(tbd);body.appendChild(tb);
    }
    doc.getElementById('history-modal').classList.add('show');
  }
  function fecharHistorico(){doc.getElementById('history-modal').classList.remove('show');}
  function exportarHistorico(){
    const d=localStorage.getItem(CONFIG.storageKey)||'[]';
    const b=new TextEncoder().encode(d);
    binaryUtils.downloadBytes(b,'historico_assinaturas_'+new Date().toISOString().slice(0,10)+'.json','application/json');
  }
  function limparHistorico(){
    if(confirm('Apagar todo o historico armazenado neste navegador?')){
      localStorage.removeItem(CONFIG.storageKey);abrirHistorico();
    }
  }

  /* ===== LGPD ===== */
  function abrirLgpdModal(){
    const body=doc.getElementById('lgpd-modal-body');body.textContent='';
    const p=doc.createElement('p');p.style.fontSize='.9rem';p.style.lineHeight='1.7';p.textContent=CONFIG.lgpdTextoCompleto;
    body.appendChild(p);doc.getElementById('lgpd-modal').classList.add('show');
  }
  function fecharLgpdModal(){doc.getElementById('lgpd-modal').classList.remove('show');}
  function ocultarBanner(){
    try{localStorage.setItem(CONFIG.storageLgpdKey,'1');}catch(e){}
    doc.getElementById('lgpd-banner').style.display='none';
  }
  function inicializarBannerLgpd(){
    try{if(localStorage.getItem(CONFIG.storageLgpdKey)==='1')doc.getElementById('lgpd-banner').style.display='none';}catch(e){}
  }

  /* ===== BINDING ===== */
  function bindEvents(){
    // Upload
    const dz=doc.getElementById('dropzone');
    const pdfInput=doc.getElementById('pdf-input');
    dz.addEventListener('click',function(){pdfInput.click();});
    ['dragenter','dragover'].forEach(function(ev){dz.addEventListener(ev,function(e){e.preventDefault();dz.classList.add('dragover');});});
    ['dragleave','drop'].forEach(function(ev){dz.addEventListener(ev,function(e){e.preventDefault();dz.classList.remove('dragover');});});
    dz.addEventListener('drop',function(e){if(e.dataTransfer&&e.dataTransfer.files[0])handlePdfUpload(e.dataTransfer.files[0]);});
    pdfInput.addEventListener('change',function(e){if(e.target.files[0])handlePdfUpload(e.target.files[0]);});

    // Mascara campos
    doc.getElementById('cpf').addEventListener('input',mascararCpfInput);
    doc.getElementById('celular').addEventListener('input',mascararCelularInput);
    // Validacao blur
    doc.getElementById('nome').addEventListener('blur',function(){validarCampoAoSair('nome',validators.nome);atualizarBotaoAssinar();});
    doc.getElementById('cpf').addEventListener('blur',function(){validarCampoAoSair('cpf',validators.cpf);atualizarBotaoAssinar();});
    doc.getElementById('celular').addEventListener('blur',function(){validarCampoAoSair('celular',validators.celular);atualizarBotaoAssinar();});
    ['nome','email','cargo'].forEach(function(id){doc.getElementById(id).addEventListener('input',atualizarBotaoAssinar);});

    // Aceites
    doc.getElementById('aceite-lgpd').addEventListener('change',function(){
      doc.getElementById('wrap-lgpd').classList.toggle('checked',doc.getElementById('aceite-lgpd').checked);
      atualizarBotaoAssinar();
    });
    doc.getElementById('aceite-assinatura').addEventListener('change',function(){
      doc.getElementById('wrap-assinatura').classList.toggle('checked',doc.getElementById('aceite-assinatura').checked);
      atualizarBotaoAssinar();
    });
    // Clicar no bloco inteiro do checkbox
    doc.getElementById('wrap-lgpd').addEventListener('click',function(e){
      if(e.target.tagName==='INPUT')return;
      const cb=doc.getElementById('aceite-lgpd');
      cb.checked=!cb.checked;
      cb.dispatchEvent(new Event('change'));
    });
    doc.getElementById('wrap-assinatura').addEventListener('click',function(e){
      if(e.target.tagName==='INPUT')return;
      const cb=doc.getElementById('aceite-assinatura');
      cb.checked=!cb.checked;
      cb.dispatchEvent(new Event('change'));
    });

    // Expandir texto completo dos aceites
    doc.getElementById('btn-ver-lgpd').addEventListener('click',function(e){
      e.stopPropagation();
      doc.getElementById('aceite-lgpd-full').classList.toggle('show');
      this.textContent=doc.getElementById('aceite-lgpd-full').classList.contains('show')?'Recolher':'Ler texto completo';
    });
    doc.getElementById('btn-ver-aceite').addEventListener('click',function(e){
      e.stopPropagation();
      doc.getElementById('aceite-assin-full').classList.toggle('show');
      this.textContent=doc.getElementById('aceite-assin-full').classList.contains('show')?'Recolher':'Ler texto completo';
    });

    // Assinatura texto e estilo
    doc.getElementById('sig-text').addEventListener('input',renderTextSignature);
    const ss=doc.getElementById('style-selector');
    ss.addEventListener('click',function(e){
      const op=e.target.closest('.style-tab');if(!op)return;
      const ft=op.getAttribute('data-font');if(CONFIG.fontsEnum.indexOf(ft)<0)return;
      const all=doc.querySelectorAll('.style-tab');
      for(let i=0;i<all.length;i++)all[i].classList.remove('active');
      op.classList.add('active');stateMutator('selectedFont',ft);renderTextSignature();
    });

    // Navegacao paginas — nav da toolbar (page-prev/next) e nav flutuante do viewer (ds-prev/ds-next)
    function navPrev(){
      const cur=stateReader('currentPage');if(cur<=0)return;
      const pos=stateReader('sigPosition');
      if(pos)stateMutator('sigPosition',Object.assign({},pos,{pageIdx:cur-1}));
      renderizarPagina(cur-1);
    }
    function navNext(){
      const cur=stateReader('currentPage');if(cur>=stateReader('totalPages')-1)return;
      const pos=stateReader('sigPosition');
      if(pos)stateMutator('sigPosition',Object.assign({},pos,{pageIdx:cur+1}));
      renderizarPagina(cur+1);
    }
    doc.getElementById('page-prev').addEventListener('click',navPrev);
    doc.getElementById('page-next').addEventListener('click',navNext);
    doc.getElementById('ds-prev').addEventListener('click',navPrev);
    doc.getElementById('ds-next').addEventListener('click',navNext);

    // Tamanho slider
    doc.getElementById('sig-size').addEventListener('input',function(e){
      const pos=stateReader('sigPosition');if(!pos)return;
      stateMutator('sigPosition',Object.assign({},pos,{widthRatio:parseFloat(e.target.value)}));
      atualizarOverlay();
    });

    // Centralizar e rodape (dois botoes: toolbar e chips abaixo)
    function moverCentro(){
      const pos=stateReader('sigPosition');if(!pos)return;
      stateMutator('sigPosition',Object.assign({},pos,{xRatio:.5,yRatio:.5}));
      atualizarOverlay();atualizarBotaoAssinar();
    }
    function moverRodape(){
      const pos=stateReader('sigPosition');if(!pos)return;
      stateMutator('sigPosition',Object.assign({},pos,{xRatio:.5,yRatio:.85}));
      atualizarOverlay();atualizarBotaoAssinar();
    }
    doc.getElementById('btn-centralizar').addEventListener('click',moverCentro);
    doc.getElementById('btn-rodape2').addEventListener('click',moverRodape);

    // Botao X da toolbar — remove assinatura e volta ao tap-to-place
    doc.getElementById('btn-limpar-pos').addEventListener('click',function(){
      stateMutator('sigPosition',null);
      overlay.style.display='none';
      atualizarChipPos(false);
      atualizarBotaoAssinar();
      atualizarProgressBar();
    });

    // Secoes colapsaveis
    for(let i=1;i<=5;i++){
      (function(idx){
        doc.getElementById('sec-'+idx+'-hdr').addEventListener('click',function(){toggleSecao(idx);});
      })(i);
    }

    // Botao assinar
    doc.getElementById('btn-assinar').addEventListener('click',executarAssinatura);

    // Historico
    doc.getElementById('link-historico').addEventListener('click',function(e){e.preventDefault();abrirHistorico();});
    doc.getElementById('btn-fechar-historico').addEventListener('click',fecharHistorico);
    doc.getElementById('btn-exportar-historico').addEventListener('click',exportarHistorico);
    doc.getElementById('btn-limpar-historico').addEventListener('click',limparHistorico);
    doc.getElementById('history-modal').addEventListener('click',function(e){if(e.target.id==='history-modal')fecharHistorico();});

    // LGPD
    doc.getElementById('lgpd-details-link').addEventListener('click',abrirLgpdModal);
    doc.getElementById('btn-fechar-lgpd').addEventListener('click',fecharLgpdModal);
    doc.getElementById('lgpd-ack').addEventListener('click',ocultarBanner);
    doc.getElementById('lgpd-modal').addEventListener('click',function(e){if(e.target.id==='lgpd-modal')fecharLgpdModal();});

    // Resize
    globalScope.addEventListener('resize',function(){setupSigCanvas();renderTextSignature();});
  }

  function init(){
    if(!pdfLibRef||!qrcodeRef||!cryptoApi||!cryptoApi.subtle||!pdfjsRef){
      mostrarStatus('Falha ao carregar dependencias. Verifique sua conexao.','error');return;
    }
    setupSigCanvas();
    bindEvents();
    inicializarBannerLgpd();
    atualizarProgressBar();
    if(doc.fonts&&doc.fonts.ready)doc.fonts.ready.then(function(){renderTextSignature();});
  }

  if(doc.readyState==='loading')doc.addEventListener('DOMContentLoaded',init);
  else init();

})(window, document, window.crypto, window.PDFLib, window.qrcode, window.pdfjsLib);
