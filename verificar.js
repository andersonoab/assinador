'use strict';

(function(){
  const dropzone=document.getElementById('dropzone');
  const pdfInput=document.getElementById('pdf-input');
  const dropzoneText=document.getElementById('dropzone-text');
  const resultado=document.getElementById('resultado');

  dropzone.addEventListener('click',function(){pdfInput.click();});
  ['dragenter','dragover'].forEach(function(ev){dropzone.addEventListener(ev,function(e){e.preventDefault();dropzone.classList.add('dragover');});});
  ['dragleave','drop'].forEach(function(ev){dropzone.addEventListener(ev,function(e){e.preventDefault();dropzone.classList.remove('dragover');});});
  dropzone.addEventListener('drop',function(e){if(e.dataTransfer.files[0])verificar(e.dataTransfer.files[0]);});
  pdfInput.addEventListener('change',function(e){if(e.target.files[0])verificar(e.target.files[0]);});

  const PDF_MAGIC=[0x25,0x50,0x44,0x46,0x2D];

  function validarMagic(buffer){
    if(!buffer||buffer.byteLength<5)return false;
    const v=new Uint8Array(buffer,0,5);
    for(let i=0;i<5;i++)if(v[i]!==PDF_MAGIC[i])return false;
    return true;
  }

  function escapeHtml(s){
    return String(s==null?'':s).replace(/[&<>"'/]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','/':'&#x2F;'}[c];});
  }
  function formatarTamanho(b){if(b<1024)return b+' B';if(b<1048576)return (b/1024).toFixed(1)+' KB';return (b/1048576).toFixed(2)+' MB';}

  async function verificar(file){
    if(file.type!=='application/pdf'){renderErro('Arquivo inválido. Selecione um PDF.');return;}
    if(file.size>30*1024*1024){renderErro('Arquivo muito grande (máx 30 MB).');return;}

    dropzone.classList.add('has-file');
    dropzoneText.textContent='';
    const st=document.createElement('strong');st.textContent=file.name;
    const sp=document.createElement('span');sp.style.fontSize='.85rem';sp.textContent=' '+formatarTamanho(file.size)+' - analisando...';
    dropzoneText.appendChild(st);dropzoneText.appendChild(document.createElement('br'));dropzoneText.appendChild(sp);

    try{
      const buffer=await file.arrayBuffer();
      if(!validarMagic(buffer)){renderErro('Arquivo não é um PDF válido.');return;}
      const PDFDocument=PDFLib.PDFDocument;
      const pdfDoc=await PDFDocument.load(buffer);
      const keywords=pdfDoc.getKeywords()||'';
      const m=keywords.match(/MANIFESTO_B64:([A-Za-z0-9+/=]+)/);
      if(!m){
        renderResultado({status:'invalid',titulo:'Documento não assinado por este sistema',
          descricao:'Não foi encontrado manifesto de assinatura nos metadados do PDF.',
          checks:[{ok:false,label:'Manifesto de assinatura',desc:'Não localizado nos metadados do PDF'}]
        });
        return;
      }
      let manifesto;
      try{var raw=atob(m[1]);var bytes=new Uint8Array(raw.length);for(var bi=0;bi<raw.length;bi++)bytes[bi]=raw.charCodeAt(bi);manifesto=JSON.parse(new TextDecoder().decode(bytes));}
      catch(e){
        renderResultado({status:'invalid',titulo:'Manifesto corrompido',
          descricao:'O manifesto foi localizado mas não pôde ser decodificado.',
          checks:[{ok:true,label:'Presença do manifesto',desc:'Localizado nos metadados'},{ok:false,label:'Decodificação',desc:'Falhou ao processar conteúdo'}]
        });
        return;
      }

      const checks=[];
      const obrig=['idAssinatura','timestampISO','documento','signatario','aceite'];
      const okEstrut=obrig.every(function(c){return manifesto[c];});
      checks.push({ok:okEstrut,label:'Estrutura do manifesto',
        desc:okEstrut?'Todos os campos obrigatórios presentes':'Faltam: '+obrig.filter(function(c){return !manifesto[c];}).join(', ')});

      const hashReg=manifesto.documento&&manifesto.documento.hashSHA256Original;
      const hashOk=/^[a-f0-9]{64}$/.test(hashReg||'');
      checks.push({ok:hashOk,label:'Hash SHA-256 do documento',
        desc:hashOk?'Hash registrado no manifesto possui formato SHA-256 válido':'Hash ausente ou em formato inválido'});

      const ts=new Date(manifesto.timestampISO);
      const tsOk=!isNaN(ts)&&ts<=new Date();
      checks.push({ok:tsOk,label:'Carimbo de tempo',
        desc:tsOk?'Data e hora da assinatura: '+ts.toLocaleString('pt-BR'):'Timestamp inválido ou futuro'});

      const aceiteOk=manifesto.aceite&&(manifesto.aceite.confirmadoAssinatura===true||manifesto.aceite.confirmado===true);
      const lgpdOk=manifesto.aceite&&manifesto.aceite.confirmadoLgpd===true;
      checks.push({ok:aceiteOk,label:'Termo de aceite',desc:aceiteOk?'Aceite expresso confirmado pelo signatário':'Aceite não confirmado'});
      checks.push({ok:lgpdOk,label:'Consentimento LGPD',desc:lgpdOk?'Tratamento de dados pessoais autorizado':'Consentimento LGPD não registrado (versão anterior do assinador)'});

      const sigOk=manifesto.signatario&&manifesto.signatario.nome&&manifesto.signatario.cpf;
      checks.push({ok:sigOk,label:'Identificação do signatário',desc:sigOk?'Nome e CPF presentes no manifesto':'Identificação incompleta'});

      const trilha=manifesto.seguranca||{};
      const trilhaOk=!!(trilha.versao||manifesto.evidencias);
      checks.push({ok:trilhaOk,label:'Trilha de segurança',desc:trilhaOk?('Evidências técnicas registradas: hash, manifesto, timestamp, IP/dispositivo quando disponíveis e aceite.'):'Documento gerado em versão anterior ou sem trilha de segurança estruturada'});

      const leituraOk=manifesto.aceite&&manifesto.aceite.confirmouLeituraDocumento===true;
      checks.push({ok:leituraOk,label:'Confirmação de leitura/conferência',desc:leituraOk?'Signatário confirmou leitura e conferência do documento':'Campo não registrado; tratar como evidência reduzida'});

      const criticosOk=okEstrut&&hashOk&&tsOk&&aceiteOk&&sigOk;
      const todosOk=criticosOk&&lgpdOk;
      renderResultado({
        status:criticosOk?(todosOk?'valid':'warning'):'invalid',
        titulo:criticosOk?(todosOk?'Assinatura válida':'Assinatura válida com observação'):'Assinatura inválida',
        descricao:criticosOk?(todosOk?'Todas as conferências passaram. Documento íntegro e assinado eletronicamente.':'Conferências críticas aprovadas. Consentimento LGPD não registrado (provavelmente versão anterior do assinador).'):'Uma ou mais conferências críticas falharam.',
        checks:checks,manifesto:manifesto
      });
    }catch(err){console.error(err);renderErro('Erro ao processar o PDF: '+err.message);}
  }

  function renderResultado(r){
    resultado.textContent='';
    // banner
    const banner=document.createElement('div');
    banner.className='result-banner '+r.status;
    const ic=document.createElement('div');ic.className='banner-icon '+r.status;
    ic.textContent=r.status==='valid'?'✓':(r.status==='invalid'?'!':'?');
    const bt=document.createElement('div');bt.className='banner-text';
    const h3=document.createElement('h3');h3.textContent=r.titulo;
    const p=document.createElement('p');p.textContent=r.descricao;
    bt.appendChild(h3);bt.appendChild(p);
    banner.appendChild(ic);banner.appendChild(bt);
    resultado.appendChild(banner);

    // checks
    const cardC=document.createElement('div');cardC.className='card';
    const h2c=document.createElement('h2');h2c.textContent='Conferências realizadas';
    cardC.appendChild(h2c);
    for(let i=0;i<r.checks.length;i++){
      const c=r.checks[i];
      const item=document.createElement('div');item.className='check-item';
      const ico=document.createElement('div');ico.className='check-icon '+(c.ok?'ok':'fail');
      ico.textContent=c.ok?'✓':'×';
      const txt=document.createElement('div');txt.className='check-text';
      const st=document.createElement('strong');st.textContent=c.label;
      const sm=document.createElement('small');sm.textContent=c.desc;
      txt.appendChild(st);txt.appendChild(sm);
      item.appendChild(ico);item.appendChild(txt);
      cardC.appendChild(item);
    }
    resultado.appendChild(cardC);

    // dados
    if(r.manifesto){
      const m=r.manifesto;
      const card=document.createElement('div');card.className='card';
      const h2=document.createElement('h2');h2.textContent='Dados da assinatura';
      card.appendChild(h2);
      const trilha=m.seguranca||{};
      const rb=document.createElement('div');
      rb.className='risk-box alto';
      const st=document.createElement('strong');st.textContent='Aviso jurídico de cautela';
      const tx=document.createElement('div');tx.textContent=trilha.aviso||'Considere sempre ICP-Brasil ou gov.br para documentos de maior risco, quitação, renúncia, transação, exigência sindical, fé pública ou necessidade de prova reforçada.';
      rb.appendChild(st);rb.appendChild(tx);card.appendChild(rb);
      const g=document.createElement('div');g.className='info-grid';

      function row(lbl,val,isCode){
        const l=document.createElement('div');l.className='label';l.textContent=lbl;
        const v=document.createElement('div');v.className='value';
        if(isCode){const c=document.createElement('code');c.style.fontSize='.72rem';c.style.wordBreak='break-all';c.textContent=val;v.appendChild(c);}
        else v.textContent=val;
        g.appendChild(l);g.appendChild(v);
      }

      row('ID da assinatura',m.idAssinatura,true);
      row('Data e hora',m.timestampLocal||new Date(m.timestampISO).toLocaleString('pt-BR'));
      row('Signatário',m.signatario.nome);
      row('CPF',m.signatario.cpf);
      if(m.signatario.celular)row('Celular',m.signatario.celular);
      if(m.signatario.cargo)row('Cargo',m.signatario.cargo);
      if(m.signatario.email)row('E-mail',m.signatario.email);
      if(m.signatario.posicaoPagina)row('Página da assinatura',String(m.signatario.posicaoPagina));
      row('Documento original',m.documento.nomeOriginal);
      if(m.seguranca){row('Versão da trilha',m.seguranca.versao||'-');row('Escopo',m.seguranca.escopo||'-');row('Aviso ICP/gov.br',m.seguranca.aviso||'-');}
      row('Hash SHA-256 (original)',m.documento.hashSHA256Original,true);
      row('IP no momento',m.evidencias.ip);
      row('Dispositivo',m.evidencias.userAgent);
      row('Fuso horário',m.evidencias.fusoHorario);
      row('Fundamento legal',m.aceite.fundamentoLegal||'-');
      card.appendChild(g);

      const ar=document.createElement('div');ar.className='actions-row';
      const btn=document.createElement('button');btn.className='btn-ghost';btn.textContent='Exportar manifesto JSON / evidência';
      btn.addEventListener('click',function(){exportarManifesto(m);});
      ar.appendChild(btn);card.appendChild(ar);
      resultado.appendChild(card);
    }

    resultado.style.display='block';
    resultado.scrollIntoView({behavior:'smooth',block:'start'});
  }

  function renderErro(msg){
    resultado.textContent='';
    const b=document.createElement('div');b.className='result-banner invalid';
    const i=document.createElement('div');i.className='banner-icon invalid';i.textContent='!';
    const t=document.createElement('div');t.className='banner-text';
    const h=document.createElement('h3');h.textContent='Não foi possível verificar';
    const p=document.createElement('p');p.textContent=msg;
    t.appendChild(h);t.appendChild(p);b.appendChild(i);b.appendChild(t);
    resultado.appendChild(b);resultado.style.display='block';
  }

  function exportarManifesto(m){
    const bytes=new TextEncoder().encode(JSON.stringify(m,null,2));
    const blob=new Blob([bytes],{type:'application/json'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');a.href=url;a.download='manifesto_'+m.idAssinatura+'.json';a.rel='noopener noreferrer';
    document.body.appendChild(a);a.click();document.body.removeChild(a);
    setTimeout(function(){URL.revokeObjectURL(url);},1500);
  }
})();
