// ============================================================
// Core.gs — Generation engine for the Baysgarth AI Co-Planner
// Speed optimisations applied:
//   1. Removed gemini-3-flash-preview from model chain (it 404s, wastes time)
//   2. thinkingBudget set to 0 for gemini-2.5-flash-lite (was 2048 — adds latency)
//   3. SVG validation retry only triggers when >2 issues (was any issue)
// ============================================================

function extractText(candidate){
  if(!candidate||!candidate.content||!candidate.content.parts)return '';
  return candidate.content.parts.map(function(p){return p.text||''}).join('');
}

function callGemini(msg,sen,history,maxTokens,useChatSystem,dept,dm,svgEnabled,temp){
  var key=PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if(!key)return{error:'GEMINI_API_KEY not set.'};
  var visualDepts={Maths:1,Statistics:1,Science:1,Physics:1,Chemistry:1,Biology:1,DT:1,Graphics:1};
  var coreDepts={English:1,'English Literature':1,'English Language':1,Drama:1,History:1,'Religious Education':1,RE:1,MFL:1,French:1,German:1,Spanish:1};
  var d=(dm||'').toLowerCase();

  var useFull=(d==='mentor')||(!d&&dept&&(visualDepts[dept]||coreDepts[dept]))||(d==='practitioner'&&dept&&(visualDepts[dept]||coreDepts[dept]));
  var chain;
  if(d==='specialist'){
    chain=['gemini-2.5-flash-lite'];
  }else if(useFull){
    // SPEED FIX 1: Removed gemini-3-flash-preview — it 404s consistently,
    // wasting 1 HTTP call and up to 6s of retry sleep before falling back.
    chain=['gemini-2.5-flash','gemini-2.5-flash-lite'];
  }else{
    chain=['gemini-2.5-flash-lite'];
  }

  var full=msg;if(sen)full+='\n\n'+sen;
  var msgs=[];if(history)for(var i=0;i<history.length;i++)msgs.push(history[i]);
  msgs.push({role:'user',parts:[{text:full}]});
  // SVG templates included ONLY when dept is SVG-eligible AND toggle is on
  var needsVisual=!!(dept&&visualDepts[dept]&&svgEnabled!==false);
  var systemText=useChatSystem?SYS_CHAT:SYS;
  if(!useChatSystem&&!needsVisual){
    var vs=systemText.indexOf('--- Inline SVG ---');
    var ve=systemText.indexOf('=============================================\nOUTPUT TYPE A');
    if(vs>0&&ve>vs)systemText=systemText.substring(0,vs)+systemText.substring(ve);
  }

  var lastError='';
  for(var ci=0;ci<chain.length;ci++){
    var model=chain[ci];
    var isFallback=(ci>0);
    var maxCap=(model==='gemini-2.5-flash-lite')?32768:8192;
    var tokens=Math.min(maxTokens||2048,maxCap);

    var thinkCfg;
    if(model.indexOf('gemini-3')===0){
      thinkCfg={thinkingLevel:'low'};
    }else if(model==='gemini-2.5-flash-lite'){
      // Specialist mode: thinkingBudget 0 — fast and concise by design, thinking is waste.
      // Practitioner/mentor fallback: thinkingBudget 512 — flash-lite is now doing
      // substantive lesson generation, so a modest thinking budget preserves quality
      // without the full cost of the original 2048.
      thinkCfg={thinkingBudget:(d==='specialist'?0:512)};
    }else{
      thinkCfg={thinkingBudget:0};
    }

    var stopSeqs=(dm==='mentor')?[]:['## END','---END---'];
    var genCfg={temperature:(temp||0.6),maxOutputTokens:tokens,thinkingConfig:thinkCfg,stopSequences:stopSeqs};
    var url='https://generativelanguage.googleapis.com/v1beta/models/'+model+':generateContent?key='+key;
    var payloadStr=JSON.stringify({contents:msgs,systemInstruction:{parts:[{text:systemText}]},generationConfig:genCfg});

    var maxRetries=(ci===chain.length-1)?3:2;
    var delay=2000;
    var shouldFallback=false;

    for(var attempt=1;attempt<=maxRetries;attempt++){
      try{
        var r=UrlFetchApp.fetch(url,{method:'post',contentType:'application/json',payload:payloadStr,muteHttpExceptions:true});
        var resCode=r.getResponseCode(),resText=r.getContentText();
        if(resCode===503){
          lastError=mapApiError_(503,resText);
          if(attempt===maxRetries){shouldFallback=true;break}
          Utilities.sleep(delay);delay*=2;continue;
        }
        if(resCode===404){
          lastError=model+' is not available (404). ';
          shouldFallback=true;break;
        }
        if(resCode!==200)return{error:mapApiError_(resCode,resText)};
        var j=JSON.parse(resText);
        if(j.error)return{error:mapApiError_(resCode,j.error.message||'')};
        if(j.candidates&&j.candidates[0]&&j.candidates[0].content){
          var t=extractText(j.candidates[0]);
          if(!t)return{error:'The AI service returned an empty response. Please try again.'};

          var finishReason=j.candidates[0].finishReason||'';
          var contCount=0,MAX_CONT=2;
          while(finishReason==='MAX_TOKENS'&&contCount<MAX_CONT){
            contCount++;
            var contMsgs=msgs.slice();
            contMsgs.push({role:'model',parts:[{text:t.length>3000?t.substring(t.length-3000):t}]});
            contMsgs.push({role:'user',parts:[{text:'Your previous response was cut off. Continue EXACTLY from where you stopped. Do not repeat any content already generated. Do not add a new title or introduction. Pick up mid-sentence if necessary.'}]});
            var contPayload=JSON.stringify({contents:contMsgs,systemInstruction:{parts:[{text:systemText}]},generationConfig:genCfg});
            try{
              var rc=UrlFetchApp.fetch(url,{method:'post',contentType:'application/json',payload:contPayload,muteHttpExceptions:true});
              if(rc.getResponseCode()===200){
                var jc=JSON.parse(rc.getContentText());
                if(jc.candidates&&jc.candidates[0]&&jc.candidates[0].content){
                  var tc=extractText(jc.candidates[0]);
                  if(tc)t=t+'\n'+tc;
                  finishReason=jc.candidates[0].finishReason||'STOP';
                }else{break}
              }else{break}
            }catch(ec){break}
          }

          var modelNote='';
          if(isFallback){
            var tried=[];
            for(var ti=0;ti<ci;ti++)tried.push(chain[ti].replace('gemini-',''));
            modelNote='Fallback: '+tried.join(', ')+' unavailable. Generated by '+model.replace('gemini-','')+'.';
          }
          return{success:true,text:t,modelUsed:model,modelNote:modelNote};
        }
        return{error:'The AI service returned an unexpected response. Please try again.'};
      }catch(e){
        lastError='Could not reach '+model+'. ';
        if(attempt===maxRetries){shouldFallback=true;break}
        Utilities.sleep(delay);delay*=2;
      }
    }
    if(!shouldFallback)break;
  }
  return{error:'All models unavailable. '+lastError+'Please try again in a minute.'};
}

function generateLesson(cc,dept,yr,topic,notes,outputType,forceVisuals,depthMode,svgEnabled){
  var isLesson=(!outputType||outputType==='Lesson');
  var dm=depthMode||'practitioner';
  var tokenBudget=depthTokenBudget_(dm);
  var svgOn=(svgEnabled!==false)&&!!(dept&&SVG_DEPTS[dept]);
  var sen={count:0,students:[]},block='';
  if(isLesson&&cc&&cc.trim()){sen=lookupSEN(cc);if(sen.error)return sen;block=buildSENBlock(sen)}
  var depth=buildDepthInstruction_(dm);
  var msg;
  if(isLesson){
    msg='Produce a complete 50-minute '+yr+' '+dept+' lesson plan on "'+topic+'"';
    if(cc)msg+=' for class '+cc;
    msg+='.\n\nFollow OUTPUT TYPE A exactly.\n';
    msg+='Output the full lesson (all BLM phase types must appear at least once, plus ## Resources Needed) first and completely before anything else.\n';
    msg+='IMPORTANT: Every phase that has an AfL CHECKPOINT instruction in the template MUST include that checkpoint. Do not skip any.\n';
    if(!svgOn&&dept&&SVG_DEPTS[dept]){
      msg+='\nNOTE: The teacher has opted out of SVG diagrams for this output. Do NOT include any inline SVG. Use LaTeX for mathematical notation and Mermaid for process diagrams where appropriate. For any spatial diagram, describe it in text and suggest the teacher uses a printed resource or textbook image.\n';
    }
    if(sen.count>0){
      msg+='Then output ## SEN Adjustments with a subsection for ALL '+sen.count+' students from the register. ';
      msg+='Each subsection must use ### [INITIALS] - [NEED] | HCP: [YES/NO] format. ';
      msg+='Reference phases by FULL NAME ("Retrieve & Connect", "Model & Discover", "Practise", "Apply", "Checkpoint & Reflect") not numbers. ';
      msg+='VERIFY: your output must contain exactly '+sen.count+' ### subsections in the SEN Adjustments area.';
    }else if(cc){msg+='No SEN data found. After the lesson, add ## Differentiation with developing/securing/extending pathways.'}
  }else{
    msg='Create a complete, print-ready standalone classroom resource for '+yr+' '+dept+' on "'+topic+'"';
    if(cc)msg+=' ('+cc+')';
    msg+='.\n\nFollow OUTPUT TYPE B exactly.\nWrite every question, task, text, table, and scaffold out in full.';
    if(!svgOn&&dept&&SVG_DEPTS[dept]){
      msg+='\nNOTE: The teacher has opted out of SVG diagrams. Do NOT include inline SVG. Use LaTeX and Mermaid only.\n';
    }
  }
  if(depth)msg+=depth;
  var deptPrompt=getDeptPrompt_(dept);
  if(deptPrompt)msg+=deptPrompt;
  if(forceVisuals){
    msg+='\n\nCRITICAL VISUAL REQUIREMENT: A previous generation was missing expected visuals. You MUST include:\n';
    if(forceVisuals.indexOf('LaTeX')!==-1)msg+='- LaTeX mathematical notation using $...$ or $$...$$ delimiters.\n';
    if(forceVisuals.indexOf('Mermaid')!==-1)msg+='- At least one Mermaid diagram.\n';
    if(forceVisuals.indexOf('SVG')!==-1&&svgOn)msg+='- At least one inline SVG diagram.\n';
    msg+='Check your output before finishing.';
  }
  if(notes)msg+='\n\nAdditional teacher requirements:\n'+notes;
  var r=callGemini(msg,block,[],tokenBudget,false,dept,dm,svgOn);
  if(r.error)return r;

  // SVG validation ONLY when SVG is on AND department is SVG-eligible — single retry
  // SPEED FIX 3: Only retry when >2 issues found.
  // Previously any single validation failure (including cosmetic ones) triggered
  // a full ~20s re-generation. Requiring >2 issues filters out minor false positives.
  if(svgOn){
    var svgVal=validateSvgMaths_(r.text);
    if(!svgVal.ok&&svgVal.issues.length>2){
      var fixMsg=msg+'\n\nCRITICAL SVG CORRECTION REQUIRED: The previous attempt had these mathematical errors in SVG diagrams:\n';
      for(var i=0;i<svgVal.issues.length;i++)fixMsg+='- '+svgVal.issues[i]+'\n';
      fixMsg+='Fix ALL of these issues. Re-check every coordinate, angle, label, and proportional length before outputting.';
      fixMsg+='\nVerify: 1) No empty placeholders 2) Proportional lengths 3) No overlapping labels 4) Right angles verified with dot product ';
      fixMsg+='5) Graph points match coordinates 6) Angle labels have degree symbols 7) No shape names as labels 8) Composite shapes: zero right-angle markers, arcs only ';
      fixMsg+='9) Both axes labelled 10) Curves with 20+ points at fractional x-values 11) Angle sums correct 12) Polygons use stroke-linejoin="round" ';
      fixMsg+='13) No forbidden SVG elements 14) No SVG/Mermaid/LaTeX in headings';
      var r2=callGemini(fixMsg,block,[],tokenBudget,false,dept,dm,svgOn);
      if(r2.success)r=r2;
    }
  }

  // Lesson completeness check
  if(isLesson&&r.success&&r.text){
    var hasCheckpoint=r.text.indexOf('Checkpoint')!==-1&&r.text.indexOf('Reflect')!==-1;
    var hasResources=r.text.indexOf('Resources Needed')!==-1||r.text.indexOf('Resources needed')!==-1;
    var hasSENSection=r.text.indexOf('SEN Adjustments')!==-1||r.text.indexOf('SEN adjustments')!==-1;
    var needsSEN=(sen.count>0);
    var isIncomplete=!hasCheckpoint||!hasResources||(needsSEN&&!hasSENSection);
    if(isIncomplete){
      var missing=[];
      if(!hasCheckpoint)missing.push('Checkpoint & Reflect phase');
      if(!hasResources)missing.push('## Resources Needed section');
      if(needsSEN&&!hasSENSection)missing.push('## SEN Adjustments section for all '+sen.count+' students');
      var compMsg='The lesson output below is INCOMPLETE. It is missing: '+missing.join(', ')+'.\n\n';
      compMsg+='Here is the incomplete output:\n\n'+r.text.substring(r.text.length-2000)+'\n\n';
      compMsg+='Continue from where the output stopped and generate ALL missing sections. Do not repeat any content already present. ';
      if(needsSEN&&!hasSENSection)compMsg+='The SEN Adjustments section MUST contain exactly '+sen.count+' student subsections using ### [INITIALS] - [NEED] | HCP: [YES/NO] format.';
      // Completeness top-up only needs the missing section (300–800 tokens max),
      // not the full lesson budget. Cap at 4096 to avoid unnecessary model overhead.
      var compR=callGemini(compMsg,block,[],4096,false,dept,dm,svgOn);
      if(compR.success&&compR.text){r.text=r.text+'\n\n'+compR.text}
    }
  }
  if(sen.count>0&&r.text){
    var hasSEN=r.text.indexOf('SEN Adjustments')!==-1||r.text.indexOf('SEN adjustments')!==-1;
    if(!hasSEN){r.senWarning='SEN Adjustments section may be missing. Consider regenerating.'}
    else{var val=validateSENOutput_(r.text,sen.count);if(!val.ok)r.senWarning='SEN Adjustments has '+val.found+' subsections but '+val.expected+' were expected. Consider regenerating.'}
  }
  var vc=checkVisualCompliance(r.text,dept,topic,isLesson?'Lesson':outputType);
  var contentWarning='';
  if(r.text&&/Act\s+\d|Scene\s+\d/i.test(r.text)){
    var litDepts={English:1,Drama:1,'English Literature':1,'English Language':1};
    if(dept&&litDepts[dept]){
      contentWarning='This output contains act/scene references and quotations. AI can misattribute or fabricate literary quotes - please verify all quotations against the original text before classroom use.';
    }
  }
  return{success:true,text:r.text,senCount:sen.count,senWarning:r?r.senWarning:undefined,visualCheck:vc,modelNote:r.modelNote||'',contentWarning:contentWarning};
}

function generateSOL(dept,yr,topic,notes,depthMode){
  var dm=depthMode||'practitioner';
  var tokenBudget=depthTokenBudget_(dm);
  var depth=buildDepthInstruction_(dm);
  var msg='Produce a complete Scheme of Learning for '+yr+' '+dept+' on "'+topic+'".\n\n';
  msg+='Follow OUTPUT TYPE C exactly.\n';
  msg+='Include ALL sections in order: Overview, Big Question, Knowledge Progression, Core Vocabulary, Retrieval Plan, Lesson Sequence, Common Misconceptions, Differentiation.\n';
  msg+='CRITICAL: The Lesson Sequence table MUST include an AfL Checkpoints column with at least 2 specific techniques per lesson.\n';
  msg+='Every learning question must be a genuine enquiry question. Label BLM phases by full name (phases may repeat and interleave within a lesson). ';
  msg+='Vary activity types and AfL techniques: no two consecutive lessons may use the same in the same phase. ';
  msg+='6-12 lessons. Final lesson must be assessment.\n';
  if(deptMatches_(dept,['maths','statistics','physics','chemistry']))msg+='IMPORTANT: Use proper LaTeX notation for ALL mathematical expressions.\n';
  if(depth)msg+=depth;
  var deptPrompt=getDeptPrompt_(dept);
  if(deptPrompt)msg+=deptPrompt;
  if(notes)msg+='\n\nAdditional teacher requirements:\n'+notes;
  var r=callGemini(msg,'',[],tokenBudget,false,dept,dm);
  if(r.error)return r;
  var contentWarning='';
  if(r.text&&/Act\s+\d|Scene\s+\d/i.test(r.text)){
    var litDepts={English:1,Drama:1,'English Literature':1,'English Language':1};
    if(dept&&litDepts[dept])contentWarning='This output contains act/scene references and quotations. AI can misattribute or fabricate literary quotes - please verify all quotations against the original text before classroom use.';
  }
  return{success:true,text:r.text,senCount:0,visualCheck:{pass:true,expected:[],found:{},missing:[]},modelNote:r.modelNote||'',contentWarning:contentWarning};
}

function generateRevision(dept,yr,topic,notes,forceVisuals,depthMode,svgEnabled){
  if(!notes||!notes.trim())return{error:'Please specify the exam board and paper/component in the Additional Notes field.'};
  var dm=depthMode||'practitioner';
  var tokenBudget=depthTokenBudget_(dm);
  var svgOn=(svgEnabled!==false)&&!!(dept&&SVG_DEPTS[dept]);
  var depth=buildDepthInstruction_(dm);
  var msg='Create exam-style practice material for '+yr+' '+dept;
  if(topic&&topic.trim())msg+=' on "'+topic+'"';
  msg+='.\n\nFollow OUTPUT TYPE E exactly.\n\nExam board/paper details:\n'+notes+'\n\n';
  msg+='CRITICAL ACCURACY REQUIREMENT: Every question stem, mark scheme point, command word, and specification reference must be as accurate as you can make it. ';
  msg+='For any specific detail you are not certain about — exact wording, mark allocations, grade thresholds, assessment objectives — add ⚠️ and "(please verify against the current specification)". ';
  msg+='Do not invent, estimate, or round figures. An incorrect exam question used in a classroom is worse than a flagged uncertain one. When in doubt, flag it explicitly.';
  if(!svgOn&&dept&&SVG_DEPTS[dept]){
    msg+='\nNOTE: The teacher has opted out of SVG diagrams. Do NOT include inline SVG. Use LaTeX and Mermaid only.\n';
  }
  if(depth)msg+=depth;
  var deptPromptRev=getDeptPrompt_(dept);
  if(deptPromptRev)msg+=deptPromptRev;
  if(forceVisuals){
    msg+='\n\nCRITICAL VISUAL REQUIREMENT: Previous generation was missing visuals. Include:\n';
    if(forceVisuals.indexOf('LaTeX')!==-1)msg+='- LaTeX for ALL formulas and expressions.\n';
    if(forceVisuals.indexOf('SVG')!==-1&&svgOn)msg+='- At least one inline SVG diagram.\n';
    msg+='Check your output.';
  }
  // Temperature 0.2 for revision: conservative generation reduces confident fabrication
  // of quotes, mark boundaries, and spec details.
  var r=callGemini(msg,'',[],tokenBudget,false,dept,dm,svgOn,0.2);
  if(r.error)return r;

  // SVG validation ONLY when SVG is on — single retry
  // Only retry when >2 issues found (cosmetic single issues don't warrant a full re-generation).
  if(svgOn){
    var svgVal=validateSvgMaths_(r.text);
    if(!svgVal.ok&&svgVal.issues.length>2){
      var fixMsg=msg+'\n\nCRITICAL SVG CORRECTION: Previous attempt had errors:\n';
      for(var i=0;i<svgVal.issues.length;i++)fixMsg+='- '+svgVal.issues[i]+'\n';
      fixMsg+='Fix ALL issues. Re-check every coordinate, label, and proportional length.\n';
      fixMsg+='Every unknown angle MUST have degree symbol. Every unknown side MUST have a unit. Right-angle squares ONLY at genuinely 90 degree corners. Curves with 20+ points. Angle sums must be correct. No SVG/Mermaid/LaTeX in headings.';
      var r2=callGemini(fixMsg,'',[],tokenBudget,false,dept,dm,svgOn,0.2);
      if(r2.success)r=r2;
    }
  }

  var contentWarning='';
  if(r.text&&/Act\s+\d|Scene\s+\d/i.test(r.text)){
    var litDepts={English:1,Drama:1,'English Literature':1,'English Language':1};
    if(dept&&litDepts[dept])contentWarning='This output contains act/scene references and quotations. AI can misattribute or fabricate literary quotes - please verify all quotations against the original text before classroom use.';
  }
  return{success:true,text:r.text,senCount:0,visualCheck:checkVisualCompliance(r.text,dept,topic,'Revision'),modelNote:r.modelNote||'',contentWarning:contentWarning};
}

function chatMessage(message,history,contextInfo){
  var msg=message;
  if(contextInfo&&contextInfo.outputText){
    var ctxHeader='CONTEXT FROM LAST PLANNER OUTPUT ';
    var meta=[];
    if(contextInfo.dept)meta.push(contextInfo.dept);if(contextInfo.yr)meta.push(contextInfo.yr);
    if(contextInfo.topic)meta.push('topic: '+contextInfo.topic);if(contextInfo.outputType)meta.push(contextInfo.outputType);
    if(meta.length)ctxHeader+='('+meta.join(' | ')+')';
    var ctxText=String(contextInfo.outputText);
    if(ctxText.length>8000)ctxText=ctxText.substring(0,8000)+'\n\n[context truncated]';
    msg=ctxHeader+':\n\n'+ctxText+'\n\n---\n\nUSER MESSAGE:\n'+message;
  }
  return callGemini(msg,'',history||[],2048,true);
}
