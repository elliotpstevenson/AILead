// ============================================================
// Prompts.gs — System prompts and depth configuration
// Speed optimisation applied:
//   4. Practitioner token budget reduced from 32,768 to 16,384
//      A full lesson plan rarely exceeds 10,000 tokens; 32,768 gave the model
//      excessive runway and increased tail latency. Mentor stays at 65,536.
// ============================================================
//
// NOTE: The SYS and buildDepthInstruction_ variables are defined in your Google
// Apps Script project and are not duplicated here (SYS is ~110KB).
// Apply the depthTokenBudget_ change below directly in your Apps Script editor.
// All other functions in this file remain unchanged.
// ============================================================

function depthTokenBudget_(depthMode){
  if(depthMode==='specialist')return 8192;
  if(depthMode==='mentor')return 65536;
  // SPEED FIX 4: Reduced from 32768 to 16384.
  // Typical full lesson plans (with SEN, Resources, all phases) are 4,000–10,000
  // tokens. 32,768 gave the model unnecessary room, increasing generation time.
  // 16,384 still provides generous headroom for detailed practitioner outputs.
  return 16384;
}

function getDeptPrompt_(dept){
  if(!dept)return '';
  var ck='dp_'+dept.trim().toLowerCase();
  var cached=cacheGet_(ck);
  if(cached!==null)return cached;
  var ss=getSS_();
  var sheet=ss.getSheetByName('Dept_Prompts');
  if(!sheet){cachePut_(ck,'',600);return '';}
  var data=sheet.getDataRange().getValues();
  for(var i=1;i<data.length;i++){
    if(String(data[i][0]).trim().toLowerCase()===dept.trim().toLowerCase()){
      var instructions=String(data[i][1]||'').trim();
      if(instructions){var result='\n\nDEPARTMENT-SPECIFIC INSTRUCTIONS (from '+dept+' lead):\n'+instructions+'\n';cachePut_(ck,result,600);return result;}
      cachePut_(ck,'',600);return '';
    }
  }
  cachePut_(ck,'',600);return '';
}

// SYS, SYS_CHAT, and buildDepthInstruction_ are defined elsewhere in this file
// in your Apps Script project. Do not overwrite them — only the functions above
// needed changes for the speed optimisation.
