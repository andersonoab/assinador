# Assinador Eletrônico de Documentos PDF

Ferramenta web 100% client-side para assinatura eletrônica avançada de documentos PDF, com posicionamento visual da assinatura, carimbo de certificado e validação de integridade. Sem backend, hospedável diretamente em GitHub Pages.

## Funcionalidades

- Upload e validação de PDF (magic bytes + limite de 20 MB)
- Identificação do signatário com validação algorítmica de CPF e celular brasileiro
- Assinatura gerada a partir de texto digitado, em três estilos cursivos (Dancing Script, Great Vibes, Caveat)
- Posicionamento visual da assinatura sobre o PDF (PDF.js): arrastar, redimensionar, navegar entre páginas
- Carimbo de certificado inserido como primeira página do PDF assinado, contendo dados completos, evidências técnicas, hash SHA-256 e QR Code de verificação
- Banner LGPD com aceite separado do termo de assinatura eletrônica
- Captura de IP, user-agent, fuso horário e resolução de tela como trilha de auditoria
- Histórico local em localStorage com exportação JSON
- Página de verificação independente que valida o PDF e extrai o manifesto embutido nos metadados

## Arquivos

- `assinador.html` — interface principal de assinatura
- `verificar.html` — interface de verificação
- `README.md` — este arquivo

Stack: HTML/CSS/JavaScript vanilla, encapsulado em IIFE com estado em closure. Bibliotecas externas via CDN: pdf-lib, pdf.js e qrcode-generator. Nenhum build, nenhum servidor.

## Deploy no GitHub Pages

1. Crie um repositório público (ex.: `assinador`).
2. Faça upload de `assinador.html`, `verificar.html` e `README.md` para a raiz.
3. Settings → Pages → Source: Deploy from a branch → main / root.
4. Aguarde a publicação. URL final: `https://SEU-USUARIO.github.io/assinador/assinador.html`.
5. O QR Code gerado no PDF aponta automaticamente para `verificar.html` no mesmo domínio.

Cache-busting recomendado: adicione query string nos links externos (`assinador.html?v=2`) após atualizações.

## Fluxo de assinatura

1. Carregue o PDF (passo 1).
2. Preencha identificação: nome, CPF, celular, e-mail opcional, cargo opcional (passo 2).
3. Digite o nome a aparecer como assinatura e escolha o estilo cursivo (passo 3).
4. Posicione a assinatura: navegue até a página desejada, arraste a caixa para a posição correta e ajuste o tamanho. Use os botões "Centralizar" ou "Mover ao rodapé" como atalho (passo 4).
5. Marque os dois aceites (LGPD e assinatura eletrônica) no passo 5.
6. Clique em "Assinar e baixar PDF".

O PDF baixado contém: a assinatura visual na posição escolhida + uma página de certificado inserida como primeira página com todos os dados de auditoria e QR Code de verificação.

## Validade jurídica

Assinatura eletrônica avançada nos termos do art. 10, §2º, da MP 2.200-2/2001 e da Lei 14.063/2020. Não-qualificada (sem certificado ICP-Brasil). Elementos que sustentam a validade:

- Identificação unívoca do signatário (nome, CPF validado, celular validado, e-mail, cargo)
- Integridade por hash SHA-256 do documento original
- Trilha de auditoria (IP, dispositivo, fuso, timestamp ISO)
- Aceite expresso confirmado (LGPD + termo de assinatura)
- Manifesto JSON embutido nos metadados do PDF e exibido visualmente na página de certificado

Para reforço probatório em litígio, recomenda-se:

- Termo de Adesão à Assinatura Eletrônica assinado fisicamente pelo empregado na admissão, autorizando esse meio
- Política Interna de Assinatura Eletrônica publicada no portal do empregado
- Guarda do PDF assinado durante o prazo prescricional trabalhista (5 anos no contrato + 2 anos após a rescisão, art. 7º, XXIX, CF/88)

Não substitui certificado ICP-Brasil em atos com fé pública exigida por lei, registro em cartório, ou documentos fiscais eletrônicos.

## LGPD

A ferramenta trata os seguintes dados pessoais do signatário: nome, CPF, celular, e-mail, cargo, IP público, user-agent, fuso horário, resolução de tela e imagem da assinatura digitalizada.

- Finalidade: formalização eletrônica do documento anexado
- Bases legais: art. 7º, II (obrigação legal), V (execução de contrato), VI (exercício regular de direitos) da Lei 13.709/2018
- Compartilhamento: dados ficam embutidos no PDF assinado, sob guarda do signatário e do empregador
- Direitos do titular: acesso, correção, anonimização, portabilidade e eliminação, observadas as exceções legais
- Retenção: prazo prescricional trabalhista

A organização que adotar a ferramenta deve indicar seu Encarregado pelo Tratamento de Dados (DPO) e publicar política específica.

## Segurança implementada

- CSP restritivo via meta tag (script-src, style-src, connect-src, object-src 'none', frame-ancestors 'none')
- Validação de magic bytes do PDF (não confia apenas no MIME)
- Validação algorítmica de CPF e celular brasileiro
- Limites rígidos de tamanho em cada campo (maxlength e slice)
- Sanitização consistente, sem innerHTML com dados do usuário
- Sem onclick inline, sem eval, sem Function constructor
- IIFE com estado privado em closure e dependências injetadas por parâmetro
- Captura de IP com timeout e cancelamento via AbortController
- ID de assinatura com getRandomValues (CSPRNG)
- localStorage tolerante a corrupção (try/catch + validação de tipo)

## Limites estruturais (GitHub Pages estático)

- Código JavaScript visível e replicável por qualquer pessoa (natureza inerente de aplicações estáticas)
- Sem rate-limiting, sem auditoria server-side, sem revogação centralizada
- Timestamp do relógio local do navegador, não de Autoridade de Carimbo de Tempo (ACT) ICP-Brasil
- Verificação do PDF assinado depende do manifesto embutido nos metadados; não há central de verificação
- SRI dos CDNs não está configurado (necessitaria self-hostar as libs). Para uso corporativo crítico, considere migrar `pdf-lib`, `pdf.js` e `qrcode-generator` para arquivos locais no próprio repositório.

## Personalização

Cores principais no início do arquivo `assinador.html` (variáveis CSS):

```css
--primary: #0083CA;
--primary-dark: #003C64;
--lgpd: #4A148C;
```

Para adaptar logo ou cabeçalho, edite a seção `<header>`. Para alterar textos de aceite, edite os blocos `.accept-box` no passo 5.

## Compatibilidade

Navegadores modernos: Chrome, Edge, Firefox, Safari (últimas 2 versões). Requer Web Crypto API, pdf-lib, pdf.js e suporte a Pointer Events.

## Versão

v2.1 — posicionamento visual via PDF.js, certificado como primeira página, banner LGPD, encapsulamento IIFE, validação de magic bytes, validação de celular, sem onclick inline, CSP restritivo.
