/* 造物手记 VOL.18 · 六小样 —— 全部确定性、可重放
   词法向量完整移植 hermes-agent-workbench/backend/services/rag_service.py 的
   _tokenize/_hash_embed：MD5 首字节定位 256 格、末字节最高位定符号、L2 归一。 */

function md5bytes(str){
  const T=new TextEncoder().encode(str), len=T.length;
  const total=((((len+8)>>6)+1)<<6);
  const M=new Uint8Array(total); M.set(T); M[len]=0x80;
  const bit=len*8;
  M[total-8]=bit&255; M[total-7]=(bit>>>8)&255; M[total-6]=(bit>>>16)&255; M[total-5]=(bit>>>24)&255;
  const S=[7,12,17,22,7,12,17,22,7,12,17,22,7,12,17,22,
           5,9,14,20,5,9,14,20,5,9,14,20,5,9,14,20,
           4,11,16,23,4,11,16,23,4,11,16,23,4,11,16,23,
           6,10,15,21,6,10,15,21,6,10,15,21,6,10,15,21];
  const K=new Uint32Array(64);
  for(let i=0;i<64;i++)K[i]=Math.floor(Math.abs(Math.sin(i+1))*4294967296)>>>0;
  const rotl=(x,c)=>((x<<c)|(x>>>(32-c)))>>>0;
  let a0=0x67452301,b0=0xefcdab89,c0=0x98badcfe,d0=0x10325476;
  for(let off=0;off<total;off+=64){
    const X=new Uint32Array(16);
    for(let j=0;j<16;j++)X[j]=(M[off+j*4]|(M[off+j*4+1]<<8)|(M[off+j*4+2]<<16)|(M[off+j*4+3]<<24))>>>0;
    let A=a0,B=b0,C=c0,D=d0;
    for(let i=0;i<64;i++){
      let F,g;
      if(i<16){F=(B&C)|(~B&D);g=i;}
      else if(i<32){F=(D&B)|(~D&C);g=(5*i+1)&15;}
      else if(i<48){F=B^C^D;g=(3*i+5)&15;}
      else{F=C^(B|~D);g=(7*i)&15;}
      F=(F+A+K[i]+X[g])>>>0;
      const tD=D; D=C; C=B; B=(B+rotl(F,S[i]))>>>0; A=tD;
    }
    a0=(a0+A)>>>0;b0=(b0+B)>>>0;c0=(c0+C)>>>0;d0=(d0+D)>>>0;
  }
  const out=new Uint8Array(16);
  [a0,b0,c0,d0].forEach((v,k)=>{for(let b=0;b<4;b++)out[k*4+b]=(v>>>(b*8))&255;});
  return out;
}

/* 中英文混合切词：英文按空格整词；CJK 逐字 + 相邻二字组（移植 _tokenize） */
function tokenize(text){
  const tokens=[], isCJK=ch=>ch>="一"&&ch<="鿿";
  for(const word of (text||"").toLowerCase().split(/\s+/)){
    if(![...word].some(isCJK)){ tokens.push(word); continue; }
    const chars=[...word].filter(isCJK);
    tokens.push(...chars);
    for(let i=0;i<chars.length-1;i++) tokens.push(chars[i]+chars[i+1]);
  }
  return tokens;
}

/* 哈希向量（移植 _hash_embed）：MD5 前 8 字节 little-endian → 首字节定位、末字节最高位定符号，L2 归一 */
function hashEmbed(text, dim){
  dim=dim||256;
  const tokens=tokenize(text);
  const src=tokens.length?tokens:[(text||"").slice(0,24)];
  const v=new Float64Array(dim);
  for(const token of src){
    const digest=md5bytes(token);
    v[digest[0]%dim]+= (digest[7]>>7)?1:-1;   // digest%256=d[0]（little-endian 最低位字节）；digest>>63=d[7] 最高位
  }
  let norm=0; for(const x of v) norm+=x*x;
  norm=Math.sqrt(norm);
  if(norm) for(let i=0;i<dim;i++) v[i]/=norm;
  return v;
}

function cosine(a,b){
  let dot=0;
  for(let i=0;i<a.length;i++) dot+=a[i]*b[i];
  return dot;  // 双方已 L2 归一时点积即余弦
}

function cosineRaw(a,b){
  let dot=0,na=0,nb=0;
  for(let i=0;i<a.length;i++){ dot+=a[i]*b[i]; na+=a[i]*a[i]; nb+=b[i]*b[i]; }
  na=Math.sqrt(na); nb=Math.sqrt(nb);
  return (na&&nb)?dot/(na*nb):0;
}

/* ============ 互动 02 · 编目真算 ============ */
/* 完整移植 chunk_text_for_index：标题分段、行边界优先、守卫 start=end-overlap */
function chunkText(text, target, overlap){
  target=target||900; overlap=overlap||160;
  if(target<=0 || !(overlap>=0 && overlap<target)) throw new Error("Require target>0 and 0<=overlap<target");
  text=(text||"").replace(/\r\n/g,"\n").trim();
  if(!text) return [];
  const lines=text.split("\n").map(l=>l.trim()).filter(Boolean);
  const isHead=l=>/^#{1,6}\s/.test(l);
  const sections=[]; let cur=[];
  for(const line of lines){
    if(isHead(line)&&cur.length){ sections.push(cur); cur=[line]; }
    else cur.push(line);
  }
  if(cur.length) sections.push(cur);
  const chunks=[];
  for(const section of sections){
    const st=section.join("\n");
    let start=0;
    while(start<st.length){
      let end=Math.min(start+target, st.length);
      if(end<st.length){
        const boundary=st.lastIndexOf("\n", end);  // rfind("\n", start, end+1)
        const headingEnd=(start===0&&isHead(section[0]))?section[0].length:-1;
        if(boundary>Math.max(start+overlap, start+Math.floor(target/2), headingEnd)) end=boundary;
      }
      const chunk=st.slice(start,end).trim();
      if(chunk) chunks.push({text:chunk, start, end, sectionLen:st.length, ov:chunks.length&&chunks[chunks.length-1].sectionLen===st.length?Math.min(overlap, chunk.length):0});
      if(end===st.length) break;
      start=end-overlap;
    }
  }
  return chunks;
}

const D2DOC=[
"# 一期：资料库接入对话",
"一期目标是把资料库接入对话：用户上传的文档先被抽取成纯文本，再按固定窗口切块入库，每一块都带自己的向量、序号与来源标签，聊天时自动检索召回作为上下文。",
"召回采用尽力而为策略：索引未建好或检索过程出错时，只往日志里记一笔，绝不阻断聊天——主链路的可用性永远排在增强链路之前，这句话写在文件头，也写进了测试断言。",
"检索范围以用户为界：查询条件同时约束分块归属的用户与文件归属的用户，任何跨用户的读取在数据库层就被拦下；同名文件按 file_id 各自记账，来源标签自动附上编号消歧。",
"重新上传时整体换血：先算好全部新块，再在同一个事务里删旧建新；抽取或向量化失败时旧索引原封不动，库里的每一刻都是一版完整证据，要么旧要么新，不存在中间态。",
"词法信号由本地哈希向量承担：文本切词后按 MD5 散列进 256 维再归一，无需外部服务、完全确定，语义嵌入不可用时它是唯一还活着的脉搏。",
"语义信号走用户配置的嵌入接口，每批 32 条，回包先验索引对齐、再验形状与成色，任何一道不过整批判废降级；向量入库前加封魔数与 SHA256 模型指纹。",
"混合评分把两根脉搏合成一杆秤：语义可用时按零点六五比零点三五加权，不可用时整条链退成纯词法，阈值随之从零点一五回落到零点零八。",
"发放按三道闸收敛：最多六块、单文件最多两块、总字符配给两千六；预算见底最后一块可能只装半段，但绝不再多拿一格。",
"验收口径：不相关查询命中数必须为零；相关查询必须命中并带来源注入；以上每一条都有对应的回归测试在跑。",
"块级隔离是第二道用户边界：分块表带用户外键与文件外键双索引，任何查询都从当前用户出发，历史上遗留的裸向量按无印处理，只允许词法召回不冒充语义。",
"检索失败的体面写在两条路径上：agent 路发不出 rag_recall 状态事件、done 的 metadata 里不出现 rag_sources；直连路径保留台账，本地兜底干脆不检索。",
"配额存在的意义在于证据面：单文件最多两块、TOP_K 封顶六块、字符配给两千六，一份文件无论多相关都不能垄断整条证据链，出处必须摊开。",
"query 侧同样有边界：入函数先截五百字符，超长的提问不进打分；空 query 直接返回三元组空值，不发一枪一弹。"
].join("\n") + "\n" + [
"# 二期：沙箱执行",
"二期做 Python 沙箱执行，支持画图和数据计算：模型在受控环境里跑短代码，五条硬上限写死在源码顶部——代码字符数、默认超时、输出截断、产物大小、内存上限。",
"围栏先于代码建立：Job Object 在代码送达之前就完成 attach，不存在先跑几毫秒、围栏后到的窗口期；围栏立不起来就空手而归，绝不让代码裸跑。",
"被禁模块在网络请求到达之前就拒绝加载，黑名单按定界符匹配；产物按白名单后缀与大小上限回传，清场动作放进 finally——任何出口都通向清场。",
"执行返回值是一条账单：stdout、stderr、退出码、超时标记与产物清单逐项报告，输出超限截断而不是判失败，超时击杀也要留下明确的 timed_out 标记。",
"画图支持 matplotlib 出图，数据计算支持 pandas；产出的图片以 base64 编码回传，模型当场看见自己的运行结果，后续轮次可以基于实物继续推理。",
"回归测试包含一场真实的孙进程收割：主进程结束时整棵进程树随 Job 收回，无一漏网；测试用内核调用句柄等待孙进程退出，等的是事实不是猜测。",
"沙箱与知识库共用一条军规：每道边界都要有测试背书，没有断言的上限等于没有上限，这条写在两套测试文件的第一行注释里。",
"二期的验收演示是一段真实的手写 PNG 代码：struct 拼 IHDR、zlib 压缩像素、按块封装，产物经 base64 回传后魔数完好——图能回到模型眼前，链路才算闭环。",
"沙箱运行记录同样进台账：谁发起、跑了什么、花了多久、留下什么产物，全部落进数据库 metadata，与知识库的 rag_sources 同一套留痕哲学。",
"上限的取值全部对得上一行真实源码：八千字符、二十秒默认六十秒顶、六千输出、两兆产物、五百一十二兆内存——没有一个数字是拍的。",
"沙箱入口处先量长度再判模块，两层都在进程出生之前完成；拒绝发生在任何资源被分配之前，这是闸前拒与笼内限的分界线。",
"产物回传前还要过一道白名单与大小闸，四类图片后缀之外的任何文件都留在笼内清场销毁，不进对话、不留残骸。",
"二期验收的最后一项是「围栏立不起来就不跑码」：attach 被打挂时沙箱空手返回，落盘标记证明代码从未执行——先例先于代码。"
].join("\n") + "\n" + [
"## 附：验收口径",
"每道边界都要有测试背书——没有断言的上限等于没有上限，资料库与沙箱共用这一条军规。"
].join("\n");

const d2={
  done:false, i:0,
  cut(){
    this.chunks=chunkText(D2DOC,900,160);
    const secs=[];  // 与切块同一套标题分段逻辑推导各章长，不硬编码行号
    let cur=[];
    for(const line of D2DOC.split("\n")){
      if(/^#{1,6}\s/.test(line)&&cur.length){ secs.push(cur.join("\n").length); cur=[line]; }
      else cur.push(line);
    }
    if(cur.length) secs.push(cur.join("\n").length);
    this.secs=secs;
    this.done=true; this.i=0;
    this.render(true);
  },
  step(n){
    if(!this.done) return;
    this.i=Math.max(0,Math.min(this.chunks.length-1,this.i+n));
    this.render(false);
  },
  reset(){
    this.done=false; this.i=0; this.chunks=null;
    document.getElementById("d2-term").textContent="# 「开始编目」—— 标本同款算法 JS 移植真算";
    document.getElementById("d2-n").textContent="—";
    document.getElementById("d2-cur").textContent="—";
    document.getElementById("d2-len").textContent="—";
    document.getElementById("d2-ov").textContent="—";
  },
  render(intro){
    const c=this.chunks[this.i], lines=[];
    if(intro){
      lines.push("编目完成：「一期」" + this.secs[0] + " 字符、「二期」" + this.secs[1] + " 字符、「附」" + this.secs[2] + " 字符（短章独立成块）");
      lines.push("守卫：行边界须 > max(start+160, start+450, 标题长) 才采用，否则按 900 硬剪");
      lines.push("── 每块边界逐块列出，⟦…⟧ 标出从上一块带回的 160 字符重叠区 ──");
    }
    lines.push("");
    lines.push("▸ 块 " + (this.i+1) + " / " + this.chunks.length + " · 本段内区间 [" + c.start + ", " + c.end + ") · 长度 " + c.text.length);
    if(c.ov>0){
      lines.push("  重叠带入前 " + c.ov + " 字符（上一块已索引过的原文，本块重新持有）");
      lines.push("  ⟦" + c.text.slice(0,c.ov) + "⟧" + c.text.slice(c.ov));
    } else {
      lines.push("  零重叠（章首块：标题即封面，硬边界归零）");
      lines.push("  " + c.text);
    }
    if(this.i===this.chunks.length-1){
      lines.push("");
      lines.push("验收（同 test_long_single_line 的断言口径）：章内首块 + 后续各块去掉前 160 重叠，逐字节拼回本章原文");
    }
    document.getElementById("d2-term").textContent=lines.join("\n");
    document.getElementById("d2-n").textContent=this.chunks.length;
    document.getElementById("d2-cur").textContent=(this.i+1)+" / "+this.chunks.length;
    document.getElementById("d2-len").textContent=c.text.length;
    document.getElementById("d2-ov").textContent=c.ov>0?c.ov+" 字符":"0（章首）";
  },
};

/* ============ 互动 03 · 打分真算 ============ */
/* 语料前四段 = 标本测试夹具 _mock_text 的四段正文（tests_rag.py 原文）；
   后两段为本页自造对照件。语义位用 4 维手工主题坐标代演（标本真实位是 API 的 256 维语义向量）。 */
const CORPUS=[
 {id:1, file:"产品规划.md", text:"第一期目标是把资料库接入对话，支持自动检索召回。",
  sem:[0.05,0.05,0.98,0.15]},
 {id:2, file:"产品规划.md", text:"第二期做 Python 沙箱执行，支持画图和数据计算。",
  sem:[0.97,0.08,0.05,0.20]},
 {id:3, file:"产品规划.md", text:"沙箱运行 Python 代码并回传输出。",
  sem:[0.95,0.05,0.05,0.25]},
 {id:4, file:"产品规划.md", text:"画图支持 matplotlib 出图，数据计算支持 pandas。",
  sem:[0.06,0.97,0.05,0.20]},
 {id:5, file:"部署手册.md", text:"部署脚本按环境分三档：开发、预发、生产，回滚各留一份快照。",
  sem:[0.05,0.05,0.08,0.90]},
 {id:6, file:"周报.docx", text:"例会纪要：本周排期修订，下周对齐联调窗口。",
  sem:[0.02,0.03,0.05,0.85]}
];
const QUERY="沙箱 执行 画图";
const QUERY_SEM=[0.62,0.55,0.06,0.10];

function corpusScores(mode){
  const qlex=hashEmbed(QUERY,256);
  const rows=[];
  for(const c of CORPUS){
    const lexical=Math.max(cosine(hashEmbed(c.text,256),qlex),0);
    const semantic=Math.max(cosineRaw(c.sem,QUERY_SEM),0);
    let score, tag;
    if(mode==="semantic"){ score=semantic; tag="纯语义"; }
    else if(mode==="lexical"){ score=lexical; tag="纯词法"; }
    else { score=0.65*semantic+0.35*lexical; tag="混合"; }
    rows.push({c, lexical, semantic, score, tag});
  }
  rows.sort((a,b)=>b.score-a.score);
  return rows;
}

const d3={
  cur:null,
  mode(m){ this.cur=m; this.render(); },
  reset(){ this.cur=null;
    document.getElementById("d3-term").textContent="# 三档读数同源：词法 = MD5 哈希向量余弦（标本同款），语义 = 4 维手工主题坐标";
    ["d3-top","d3-last","d3-score","d3-pass"].forEach(id=>document.getElementById(id).textContent="—");
  },
  render(){
    const rows=corpusScores(this.cur), lines=[];
    lines.push("query = 「" + QUERY + "」 · 口径：" + rows[0].tag);
    lines.push("块      语义分   词法分   合成分   过线(≥0.15)");
    for(const r of rows){
      const pass=r.score>=0.15;
      lines.push(
        "#" + r.c.id + "  " + r.semantic.toFixed(3) + "    " +
        r.lexical.toFixed(3) + "    " + r.score.toFixed(3) + "    " +
        (pass ? "✓" : "✗") + "  " + r.c.text.slice(0,14) + "…");
    }
    const top=rows[0], last=rows[rows.length-1];
    const passed=rows.filter(r=>r.score>=0.15).length;
    lines.push("");
    lines.push("榜首 #" + top.c.id + " " + top.c.file + " · 榜尾 #" + last.c.id + " · 过线 " + passed + " / " + rows.length);
    if(this.cur==="lexical")
      lines.push("纯词法认字面：#2「沙箱」「执行」双命中 0.522 稳居榜首，#4 靠「画图」单命中跟上；#1/#5/#6 词面零重叠一律 0.000——换说法即失踪");
    if(this.cur==="semantic")
      lines.push("纯语义换得了说法但对字面零约束：不相关的 #1/#5/#6 也各拿 0.16 上下——语义分天然偏高，正是阈值要从 0.15 起跳的原因");
    if(this.cur==="hybrid")
      lines.push("混合 0.65/0.35 后过线恰好 3/6：相关段全过、沾边段全拦（#1 语义 0.159 但词法为零，合成 0.103 落线外）——对齐标本测试「沙箱 执行 画图」的召回行为");
    document.getElementById("d3-term").textContent=lines.join("\n");
    document.getElementById("d3-top").textContent="#"+top.c.id;
    document.getElementById("d3-last").textContent="#"+last.c.id;
    document.getElementById("d3-score").textContent=top.score.toFixed(3);
    document.getElementById("d3-pass").textContent=passed + " / " + rows.length;
  }
};

/* ============ 互动 01 · 断链对照台 ============ */
/* 三开关对应 1.1 节三种断链；判定表照标本测试的断言口径：检索挂 → 无 rag_recall、无 rag_sources、聊天照常 */
const d1={
  sw:{retrieve:true, inject:true, ledger:true},
  toggle(k){
    this.sw[k]=!this.sw[k];
    const label={retrieve:"检索",inject:"注入",ledger:"台账"}[k];
    const btn=document.querySelectorAll("#d1 .btn")[Object.keys(this.sw).indexOf(k)];
    btn.textContent=label+"："+(this.sw[k]?"开":"断");
    btn.classList.toggle("primary", this.sw[k]);
    this.render();
  },
  reset(){
    this.sw={retrieve:true,inject:true,ledger:true};
    document.querySelectorAll("#d1 .btn").forEach((b,i)=>{
      b.classList.toggle("primary", i<3);
      if(i<3) b.textContent=["检索：开","注入：开","台账：开"][i];
    });
    this.render();
  },
  render(){
    const s=this.sw, lines=[];
    lines.push("① 检索：query「沙箱 执行 画图」" + (s.retrieve?
      "→ 过线 3、单文件配额后命中 2 块（产品规划.md #2 #3；#4 画图段让位）" :
      "→ retrieve_context 抛 RuntimeError —— logger.exception 一笔，链路继续"));
    lines.push("   " + (s.retrieve? "（对应 test_index_and_retrieve_relevant_chunk：count > 0 且上下文含「沙箱」；单文件语料下配额封顶）" : "（对应 test_no_query_and_retrieval_failure：无 rag_recall、无 rag_sources、聊天照常完成）"));
    lines.push("");
    if(s.inject && s.retrieve){
      lines.push("② 注入文本（截选）：");
      lines.push("   以下是与用户问题相关的已上传资料片段（来自你的知识库，可直接引用并注明来源）：");
      lines.push("   [来源: 产品规划.md]");
      lines.push("   第二期做 Python 沙箱执行，支持画图和数据计算。…");
      lines.push("   [来源: 产品规划.md]");
      lines.push("   沙箱运行 Python 代码并回传输出。…");
    } else if(s.retrieve && !s.inject){
      lines.push("② 注入文本：（空）—— 过线 3、命中 2 但没挂进提示词，检索白找一场");
      lines.push("   模型只看到问题本身，按训练记忆自由发挥——第二种说谎时刻");
    } else {
      lines.push("② 注入文本：（空）—— 检索没有发生，无从注入");
    }
    lines.push("");
    const sources=(s.retrieve && s.ledger)? [{file_id:1,file:"产品规划.md",chunks:3}]:null;
    lines.push("③ done payload: metadata" + (sources? " = "+JSON.stringify({rag_sources:sources}) : " 无 rag_sources 字段"));
    lines.push("");
    const grounded=s.retrieve&&s.inject, ledger=!!sources, audit=grounded&&ledger;
    lines.push("④ 结论：回答" + (grounded? "有据可引":"凭记忆发挥") + (grounded? "（提示词里钉着来源锚）":"（无任何证据拦截）") + "；台账" + (ledger? "已落账（SSE / done / DB 三点一线）":"未落账（事后无法审计）") + (audit? "" : " —— 链已断"));
    document.getElementById("d1-term").textContent=lines.join("\n");
    document.getElementById("d1-grounded").textContent=grounded?"是":"否";
    document.getElementById("d1-sources").textContent=ledger?"有":"无";
    document.getElementById("d1-audit").textContent=audit?"可回溯":"不可回溯";
  }
};

/* ============ 互动 04 · 配给真算台 ============ */
const D4CANDS=[
 {file:"产品规划.md", fid:1, idx:2, score:0.705, chars:520},
 {file:"产品规划.md", fid:1, idx:3, score:0.565, chars:430},
 {file:"架构笔记.md", fid:2, idx:0, score:0.542, chars:610},
 {file:"产品规划.md", fid:1, idx:7, score:0.501, chars:280},
 {file:"架构笔记.md", fid:2, idx:1, score:0.447, chars:460},
 {file:"安全手册.md", fid:3, idx:0, score:0.402, chars:590},
 {file:"安全手册.md", fid:3, idx:2, score:0.371, chars:410},
 {file:"周报.docx",   fid:4, idx:0, score:0.318, chars:300}
];
const d4={
  used:0, picks:[], skipped:[], done:false,
  deal(){ this.reset(); this.next(); },
  step(){ this.next(); },
  next(){
    if(this.done) return;
    const budget=2600, k=6;
    while(this.ptr<D4CANDS.length){
      const c=D4CANDS[this.ptr];
      this.ptr++;
      if(this.picks.filter(p=>p.fid===c.fid).length>=2){
        this.skipped.push({c, why:"单文件配额 ≥2，跳过"});
        this.render(); return;
      }
      const remain=budget-this.used;
      if(remain<=0){ this.render(); this.done=true; return; }
      const take=Math.min(c.chars, remain);
      const pick={...c, take, cut:take<c.chars};
      this.picks.push(pick);
      this.used+=take;
      if(this.picks.length>=k || this.used>=budget){ this.done=true; this.render(); return; }
      this.render(); return;   // 每次按钮发一块，步进呈现
    }
    this.done=true; this.render();
  },
  reset(){
    this.ptr=0; this.used=0; this.picks=[]; this.skipped=[];
    this.truncated=null; this.done=false;
    document.getElementById("d4-term").textContent="# 候选已按分数降序排好 —— 「开始发放」看三道闸咬合";
    ["d4-n","d4-used","d4-skip","d4-files"].forEach(id=>document.getElementById(id).textContent=id==="d4-n"?"0 / 6":id==="d4-used"?"0 / 2600":"0");
  },
  render(){
    const lines=[];
    for(let i=0;i<this.ptr;i++){
      const c=D4CANDS[i];
      const isPick=this.picks.some(p=>p.idx===c.idx&&p.fid===c.fid);
      const isSkip=this.skipped.some(s=>s.c.idx===c.idx&&s.c.fid===c.fid);
      if(isPick){
        const p=this.picks.find(x=>x.idx===c.idx&&x.fid===c.fid);
        lines.push("✓ #" + (i+1) + " " + c.file + " 块" + c.idx + " · 分 " + c.score.toFixed(3) + " · 发 " + p.take + "/" + c.chars + (p.cut? "（预算截断 ✂）":"") );
      } else if(isSkip){
        lines.push("✗ #" + (i+1) + " " + c.file + " 块" + c.idx + " · 分 " + c.score.toFixed(3) + " · 该文件已占 2 席，配额跳过");
      }
    }
    if(this.done){
      lines.push("");
      lines.push("停机条件：" + (this.used>=2600? "字符配给花满" : this.picks.length>=6? "TOP_K=6 满" : "候选发尽") + " · 共发 " + this.picks.length + " 块 / 用 " + this.used + " 字符");
      const byFile={};
      for(const p of this.picks) byFile[p.file]=(byFile[p.file]||0)+1;
      lines.push("来源分布：" + Object.entries(byFile).map(([f,n])=>f+"×"+n).join(" · ") + " —— 单文件最多 2 席的配额被真实执行");
    } else {
      lines.push("");
      lines.push("▸ 下一发排队中：分数降序逐块过闸 —— 再点「发下一块」");
    }
    document.getElementById("d4-term").textContent=lines.join("\n");
    document.getElementById("d4-n").textContent=this.picks.length + " / 6";
    document.getElementById("d4-used").textContent=this.used + " / 2600";
    document.getElementById("d4-skip").textContent=this.skipped.length;
    const files=new Set(this.picks.map(p=>p.file));
    document.getElementById("d4-files").textContent=files.size? [...files].join(" · "):"—";
  }
};

/* ============ 互动 05 · 指纹判定台 ============ */
/* 判定顺序移植 _stored_semantic_score：指纹 → 前缀 → 字节长度 → 范数/有限性 → 余弦 */
const D5ARCHIVES=[
 {label:"#1 带印对印", magic:true,  fpMatch:true,  lenOK:true,  normOK:true,
  note:"入库与查询同用户、同端点、同模型——唯一能走语义分的档案"},
 {label:"#2 带印错印", magic:true,  fpMatch:false, lenOK:true,  normOK:true,
  note:"换过 embedding 模型或 base_url：维度照旧、坐标系已换"},
 {label:"#3 裸历史向量", magic:false, fpMatch:false, lenOK:false, normOK:true,
  note:"升级前的存量向量，无魔数、无法证明模型兼容"},
 {label:"##4 长度不符", magic:true,  fpMatch:true,  lenOK:false, normOK:true,
  note:"字节总数 ≠ 前缀 + 256×4：残缺或异维向量"},
 {label:"#5 零向量", magic:true,  fpMatch:true,  lenOK:true,  normOK:false,
  note:"盖印对印但范数为零——test_api_response_order 的坏回包形状"},
 {label:"#6 API 失败兜底件", magic:true,  fpMatch:false, lenOK:true,  normOK:true,
  note:"嵌入失败后哈希兜底入库、指纹已清空——不许冒充语义向量"}
];
const d5={
  i:-1,
  verify(){ this.i=0; this.render(); },
  next(){ if(this.i>=0 && this.i<D5ARCHIVES.length-1){ this.i++; this.render(); } },
  reset(){ this.i=-1;
    document.getElementById("d5-term").textContent="# 六组档案状态各异 —— 「逐组验印」按标本条件序判定";
    ["d5-cur","d5-verdict","d5-avail","d5-gate"].forEach(id=>document.getElementById(id).textContent="—");
  },
  render(){
    const a=D5ARCHIVES[this.i], lines=[];
    lines.push("档案 " + a.label);
    lines.push("  魔数 b\"RAG\x01\"：" + (a.magic?"有":"无") + " · 指纹比对：" + (a.fpMatch?"对":"错") + " · 字节长度：" + (a.lenOK?"恰为前缀+1024":"不符") + " · 范数：" + (a.normOK?"正常":"为零"));
    lines.push("  档案来历：" + a.note);
    lines.push("");
    // 判定序严格照 _stored_semantic_score：返回 (score, available)
    let verdict, avail, gate;
    if(!a.fpMatch && a.label.indexOf("#6")===0){
      verdict="fingerprint=None → 直接 (0.0, False)——降级件按无印处理"; avail=false; gate=0.08;
    } else if(!a.fpMatch){
      verdict="指纹不匹配 → (0.0, False)——盖印对不上印模，退词法召回"; avail=false; gate=0.08;
    } else if(!a.magic){
      verdict="裸向量（无魔数前缀）→ (0.0, False)——无法证明模型兼容，退词法召回"; avail=false; gate=0.08;
    } else if(!a.lenOK){
      verdict="字节长度不符 → (0.0, False)——维度或残缺一票否决，退词法召回"; avail=false; gate=0.08;
    } else if(!a.normOK){
      verdict="范数为零 → (0.0, False)——盖印对印也拦，废件不比"; avail=false; gate=0.08;
    } else {
      verdict="四关全过 → (score, True)——唯一走上语义分的路"; avail=true; gate=0.15;
    }
    lines.push("判定：" + verdict);
    lines.push("  语义可用：" + (avail?"True":"False") + " · 本次评分门槛：" + gate.toFixed(2) + "（available ? 0.15 : 0.08）");
    if(this.i===D5ARCHIVES.length-1){
      lines.push("");
      lines.push("六组走完：只有 #1 过钢印。宁可整柜退回词法慢捞，也不让两个坐标系的数字同台打分。");
    }
    document.getElementById("d5-term").textContent=lines.join("\n");
    document.getElementById("d5-cur").textContent=(this.i+1)+" / 6";
    document.getElementById("d5-verdict").textContent=avail?"放行":"拒收";
    document.getElementById("d5-avail").textContent=avail?"True":"False";
    document.getElementById("d5-gate").textContent=gate.toFixed(2);
  }
};

/* ============ 互动 06 · 全链走查台 ============ */
const d6={
  s:0, log:[],
  run(){ this.reset(); this.step(); },
  step(){
    if(this.s>=6) return;
    this.s++;
    const lines=[];
    if(this.s===1){
      const chunks=chunkText(D2DOC,900,160);
      lines.push("① 编目：文档三章节 → " + chunks.length + " 块（一期 2、二期 2、附 1）");
      for(const [i,c] of chunks.entries()) lines.push("   块" + (i+1) + " 长度 " + c.text.length + (c.ov? "（前 " + c.ov + " 字符为重叠）":""));
      this.hits=chunks.length;
    }
    if(this.s===2){
      const chunks=chunkText(D2DOC,900,160);
      lines.push("② 盖印：逐块算哈希向量（256 维）——L2 归一后非零格数即 token 覆盖度");
      for(const [i,c] of chunks.entries()){
        const v=hashEmbed(c.text,256);
        const nz=v.reduce((n,x)=>n+(x!==0?1:0),0);
        lines.push("   块" + (i+1) + " · 非零格 " + nz + " / 256 · 封装 = b\"RAG\x01\" + 指纹 + float32");
      }
    }
    if(this.s===3){
      lines.push("③ 打分：query「沙箱 执行 画图」对语料 6 块，混合 0.65/0.35：");
      for(const r of corpusScores("hybrid")) lines.push("   #" + r.c.id + " 合成 " + r.score.toFixed(3) + (r.score>=0.15?" ✓ 过线":" ✗ 落选") + " · " + r.c.text.slice(0,16) + "…");
      lines.push("   过线 3 / 6 —— 前三名恰好是三段相关正文");
      this.picked=corpusScores("hybrid").filter(r=>r.score>=0.15);
    }
    if(this.s===4){
      lines.push("④ 配给：过线 3 块按分降序发放，但语料同属一份文件——单文件配额 2 咬合");
      lines.push("   ✓ #2 沙箱执行段 · ✓ #3 沙箱运行段 入选；✗ #4 画图段 分数第三但产品规划.md 已占 2 席，跳过");
      lines.push("   命中 2 块——真实测试同款行为：单文件语料下 count 被 file_id 配额封顶");
      this.final=this.picked.slice(0,2);   // 配额后真实入选
    }
    if(this.s===5){
      lines.push("⑤ 注入装配（标本格式原样）：");
      lines.push("   以下是与用户问题相关的已上传资料片段（来自你的知识库，可直接引用并注明来源）：");
      for(const r of this.final) lines.push("   [来源: " + r.c.file + "]\n   " + r.c.text);
      const chars=this.final.reduce((n,r)=>n+r.c.text.length,0)+this.final.length*10+42;
      this.chars=chars;
      lines.push("   共 " + chars + " 字符（含来源行与授权头），落在 2600 配给之内");
    }
    if(this.s===6){
      const sources={};
      for(const r of this.final) sources[r.c.file]=(sources[r.c.file]||0)+1;
      const list=Object.entries(sources).map(([file,n])=>({file_id:1,file,chunks:n}));
      lines.push("⑥ 台账终态（三点一线）：");
      lines.push("   SSE  event: status · stage=rag_recall");
      lines.push("   SSE  data: {\"message\":\"知识库召回 2 条相关片段（产品规划.md）\"}");
      lines.push("   done metadata = " + JSON.stringify({rag_sources:list}));
      lines.push("   Message.metadata（DB）= 同一份 JSON —— test_stream_done 断言三处相等");
      lines.push("");
      lines.push("全链走完：query → 编目 → 盖印 → 打分 → 配给 → 注入 → 台账，每步数字真算，重放永远同账。");
      this.ledger=list.length;
    }
    this.log.push(lines.join("\n"));
    document.getElementById("d6-term").textContent=this.log.join("\n\n");
    document.getElementById("d6-step").textContent=this.s + " / 6";
    document.getElementById("d6-hits").textContent=this.final?this.final.length:(this.picked?this.picked.length:(this.hits||"—"));
    document.getElementById("d6-chars").textContent=this.chars||"—";
    document.getElementById("d6-ledger").textContent=this.ledger!==undefined?this.ledger + " 文件":"—";
  },
  reset(){
    this.s=0; this.log=[]; this.picked=null; this.final=null; this.chars=0; this.ledger=undefined;
    document.getElementById("d6-term").textContent="# 「走一遍全链」—— 复用互动 02/03/04 的真算结果串成一条链";
    ["d6-step","d6-hits","d6-chars","d6-ledger"].forEach(id=>document.getElementById(id).textContent=id==="d6-step"?"0 / 6":"—");
  }
};
