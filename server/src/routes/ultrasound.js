/**
 * Ultrasound Analysis Routes
 *
 * Provides AI analysis for ultrasound findings from UltraLinq.
 * Integrates with the medical telemetry pipeline.
 */

import express from 'express';
import { storeEvent } from '../storage/file-store.js';

const router = express.Router();

// =============================================================================
// ULTRASOUND ANALYSIS ENDPOINT
// =============================================================================

/**
 * POST /api/ultrasound/analyze
 *
 * Analyzes ultrasound findings and provides:
 * - Clinical recommendations
 * - Suggested CPT codes
 * - Risk assessment
 * - Follow-up recommendations
 */
router.post('/analyze', async (req, res) => {
  try {
    const {
      studyType,
      patientInfo,
      measurements,
      findings,
      conclusion,
      imageCount,
      correlationId
    } = req.body;

    console.log(`[Ultrasound] Analyzing ${studyType} study for ${patientInfo?.name || 'unknown'}`);

    // Build analysis based on study type
    const analysis = analyzeUltrasoundStudy(studyType, measurements, findings, conclusion);

    // Suggest CPT codes based on study type and findings
    const suggestedCPT = suggestCPTCodes(studyType, measurements, findings);

    // Store event for telemetry
    const event = {
      source: 'medical-mirror-observer',
      type: 'ULTRASOUND_ANALYSIS',
      event: {
        stage: 'ai_analysis',
        action: 'ULTRASOUND_ANALYZED',
        success: true,
        timestamp: new Date().toISOString(),
        correlationId: correlationId || `obs-${Date.now()}`,
        data: {
          studyType,
          patientName: patientInfo?.name,
          measurementCount: measurements?.split('\n').length || 0,
          cptCodesCount: suggestedCPT.length
        }
      }
    };

    // Log to storage (fire and forget)
    storeEvent(event).catch(err => console.warn('[Ultrasound] Event store error:', err.message));

    res.json({
      success: true,
      studyType,
      analysis: {
        summary: analysis.summary,
        riskLevel: analysis.riskLevel,
        keyFindings: analysis.keyFindings,
        recommendations: analysis.recommendations
      },
      suggestedCPT,
      followUp: analysis.followUp,
      correlationId: event.event.correlationId
    });

  } catch (error) {
    console.error('[Ultrasound] Analysis error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/ultrasound/cpt-codes
 *
 * Returns CPT code reference for ultrasound studies
 */
router.get('/cpt-codes', (req, res) => {
  res.json({
    success: true,
    codes: CPT_CODES
  });
});

/**
 * POST /api/ultrasound/validate-cpt
 *
 * Validates CPT codes against study type and findings.
 * Returns validation status with confidence and any warnings.
 */
router.post('/validate-cpt', async (req, res) => {
  try {
    const {
      cptCodes,       // Array of codes to validate: [{ code: '93880', description: '...' }]
      studyType,      // e.g., 'carotid', 'aorta', 'venous'
      measurements,   // Raw measurement text
      findings,       // Findings text
      isBilateral,    // Optional: explicit bilateral flag
      correlationId
    } = req.body;

    console.log(`[CPT Validation] Validating ${cptCodes?.length || 0} codes for ${studyType} study`);

    const validationResults = validateCPTCodes(cptCodes, studyType, measurements, findings, isBilateral);

    // Store validation event
    const event = {
      source: 'medical-mirror-observer',
      type: 'CPT_VALIDATION',
      event: {
        stage: 'billing_validation',
        action: 'CPT_VALIDATED',
        success: true,
        timestamp: new Date().toISOString(),
        correlationId: correlationId || `cpt-${Date.now()}`,
        data: {
          studyType,
          codesSubmitted: cptCodes?.length || 0,
          codesValid: validationResults.validCodes.length,
          codesInvalid: validationResults.invalidCodes.length,
          warnings: validationResults.warnings.length
        }
      }
    };

    storeEvent(event).catch(err => console.warn('[CPT Validation] Event store error:', err.message));

    res.json({
      success: true,
      validation: validationResults,
      correlationId: event.event.correlationId
    });

  } catch (error) {
    console.error('[CPT Validation] Error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// =============================================================================
// CPT VALIDATION LOGIC
// =============================================================================

/**
 * Validates CPT codes against study type and clinical context
 */
function validateCPTCodes(cptCodes, studyType, measurements, findings, explicitBilateral) {
  const result = {
    validCodes: [],
    invalidCodes: [],
    warnings: [],
    suggestions: [],
    overallValid: true,
    confidence: 'high'
  };

  if (!cptCodes || cptCodes.length === 0) {
    result.overallValid = false;
    result.warnings.push('No CPT codes provided for validation');
    return result;
  }

  const studyLower = studyType?.toLowerCase() || '';
  const combinedText = ((measurements || '') + (findings || '')).toLowerCase();

  // Determine if bilateral from text or explicit flag
  const isBilateral = explicitBilateral ??
    (combinedText.includes('bilateral') || combinedText.includes('both sides') || combinedText.includes('both legs'));

  // Build valid code set for this study type
  const expectedCodes = getExpectedCodesForStudy(studyLower, isBilateral);
  const allValidCodes = getAllValidCodes();

  for (const cptEntry of cptCodes) {
    const code = typeof cptEntry === 'string' ? cptEntry : cptEntry.code;

    // Check if code exists in our database
    if (!allValidCodes.includes(code)) {
      result.invalidCodes.push({
        code,
        reason: 'Code not found in ultrasound CPT database',
        severity: 'error'
      });
      result.overallValid = false;
      continue;
    }

    // Check if code is appropriate for study type
    if (expectedCodes.includes(code)) {
      result.validCodes.push({
        code,
        status: 'valid',
        matchesStudyType: true,
        matchesBilaterality: true
      });
    } else {
      // Code exists but may not match study type
      const codeInfo = findCodeInfo(code);
      const warning = {
        code,
        expectedFor: codeInfo.studyType,
        actualStudy: studyType,
        reason: `Code ${code} is typically used for ${codeInfo.studyType} studies, not ${studyType}`
      };

      result.warnings.push(warning);
      result.validCodes.push({
        code,
        status: 'valid_with_warning',
        matchesStudyType: false,
        warning: warning.reason
      });
      result.confidence = 'medium';
    }
  }

  // Suggest codes if none provided match
  if (result.validCodes.length === 0 || result.validCodes.every(c => c.status === 'valid_with_warning')) {
    const suggested = suggestCPTCodes(studyType, measurements, findings);
    if (suggested.length > 0) {
      result.suggestions = suggested.map(s => ({
        code: s.code,
        description: s.description,
        reason: `Recommended for ${studyType} study`
      }));
    }
  }

  // Check for bilaterality mismatch
  if (isBilateral) {
    const hasBilateralCode = result.validCodes.some(c => {
      const info = findCodeInfo(c.code);
      return info?.variant === 'bilateral' || info?.variant === 'complete';
    });

    if (!hasBilateralCode) {
      result.warnings.push({
        type: 'bilaterality_mismatch',
        message: 'Study appears bilateral but codes suggest unilateral - verify correct code selection'
      });
      result.confidence = 'low';
    }
  }

  return result;
}

/**
 * Get expected CPT codes for a study type
 */
function getExpectedCodesForStudy(studyType, isBilateral) {
  const codes = [];

  if (studyType.includes('carotid')) {
    codes.push(isBilateral ? '93880' : '93882');
  } else if (studyType.includes('aorta')) {
    codes.push('93978', '93979');
  } else if (studyType.includes('venous') || studyType.includes('vein')) {
    codes.push(isBilateral ? '93970' : '93971');
  } else if (studyType.includes('arterial') || studyType.includes('artery')) {
    codes.push(isBilateral ? '93925' : '93926');
  } else if (studyType.includes('renal')) {
    codes.push('93975', '93976');
  }

  return codes;
}

/**
 * Get all valid ultrasound CPT codes
 */
function getAllValidCodes() {
  const codes = [];
  for (const category of Object.values(CPT_CODES)) {
    for (const variant of Object.values(category)) {
      codes.push(variant.code);
    }
  }
  return codes;
}

/**
 * Find code info from our database
 */
function findCodeInfo(code) {
  for (const [studyType, variants] of Object.entries(CPT_CODES)) {
    for (const [variant, info] of Object.entries(variants)) {
      if (info.code === code) {
        return { ...info, studyType, variant };
      }
    }
  }
  return null;
}

// =============================================================================
// ANALYSIS LOGIC
// =============================================================================

const CPT_CODES = {
  carotid: {
    bilateral: { code: '93880', description: 'Duplex scan of extracranial arteries; complete bilateral study' },
    unilateral: { code: '93882', description: 'Duplex scan of extracranial arteries; unilateral or limited study' }
  },
  aorta: {
    complete: { code: '93978', description: 'Duplex scan of aorta, inferior vena cava, iliac vasculature' },
    limited: { code: '93979', description: 'Duplex scan of aorta, IVC, iliac; limited study' }
  },
  venous_lower: {
    complete: { code: '93970', description: 'Duplex scan of extremity veins; complete bilateral study' },
    unilateral: { code: '93971', description: 'Duplex scan of extremity veins; unilateral or limited study' }
  },
  arterial_lower: {
    complete: { code: '93925', description: 'Duplex scan of lower extremity arteries; complete bilateral' },
    unilateral: { code: '93926', description: 'Duplex scan of lower extremity arteries; unilateral or limited' }
  },
  renal: {
    complete: { code: '93975', description: 'Duplex scan of arterial inflow and venous outflow of abdominal organs' },
    limited: { code: '93976', description: 'Duplex scan of arterial inflow and venous outflow; limited study' }
  }
};

function analyzeUltrasoundStudy(studyType, measurements, findings, conclusion) {
  const analysis = {
    summary: '',
    riskLevel: 'normal',
    keyFindings: [],
    recommendations: [],
    followUp: ''
  };

  switch (studyType?.toLowerCase()) {
    case 'carotid':
      analysis.summary = analyzeCarotid(measurements, findings, conclusion, analysis);
      break;
    case 'aorta':
      analysis.summary = analyzeAorta(measurements, findings, conclusion, analysis);
      break;
    case 'venous':
    case 'lower_venous':
      analysis.summary = analyzeVenous(measurements, findings, conclusion, analysis);
      break;
    case 'lower_arterial':
    case 'arterial':
      analysis.summary = analyzeArterial(measurements, findings, conclusion, analysis);
      break;
    default:
      analysis.summary = `${studyType || 'Unknown'} ultrasound study analyzed. Review findings manually.`;
      analysis.recommendations.push('Manual review recommended for non-standard study type');
  }

  return analysis;
}

function analyzeCarotid(measurements, findings, conclusion, analysis) {
  const measurementText = measurements?.toLowerCase() || '';
  const findingsText = findings?.toLowerCase() || '';

  // Check for stenosis indicators
  if (measurementText.includes('psv') || measurementText.includes('velocity')) {
    const psvMatch = measurementText.match(/ica.*?psv.*?(\d+)/i) || measurementText.match(/psv.*?(\d+)/i);
    if (psvMatch) {
      const psv = parseInt(psvMatch[1]);
      if (psv > 230) {
        analysis.riskLevel = 'high';
        analysis.keyFindings.push(`Elevated ICA PSV (${psv} cm/s) - suggests >70% stenosis`);
        analysis.recommendations.push('Consider CTA/MRA for confirmation');
        analysis.recommendations.push('Vascular surgery consultation recommended');
      } else if (psv > 125) {
        analysis.riskLevel = 'moderate';
        analysis.keyFindings.push(`Moderately elevated ICA PSV (${psv} cm/s) - suggests 50-69% stenosis`);
        analysis.recommendations.push('Medical management with risk factor modification');
        analysis.recommendations.push('Follow-up ultrasound in 6 months');
      }
    }
  }

  if (findingsText.includes('plaque') || measurementText.includes('plaque')) {
    analysis.keyFindings.push('Atherosclerotic plaque identified');
    if (findingsText.includes('ulcerated') || findingsText.includes('irregular')) {
      analysis.riskLevel = analysis.riskLevel === 'normal' ? 'moderate' : analysis.riskLevel;
      analysis.keyFindings.push('Plaque morphology: irregular/ulcerated - higher embolic risk');
    }
  }

  if (analysis.riskLevel === 'normal') {
    analysis.keyFindings.push('No significant stenosis identified');
    analysis.followUp = 'Routine follow-up as clinically indicated';
  } else {
    analysis.followUp = analysis.riskLevel === 'high'
      ? 'Urgent follow-up within 1-2 weeks'
      : 'Follow-up in 6 months recommended';
  }

  return `Carotid duplex analysis: ${analysis.riskLevel} risk. ${analysis.keyFindings.length} findings identified.`;
}

function analyzeAorta(measurements, findings, conclusion, analysis) {
  const measurementText = measurements?.toLowerCase() || '';

  const diameterMatch = measurementText.match(/(\d+\.?\d*)\s*cm/i) || measurementText.match(/diameter.*?(\d+\.?\d*)/i);
  if (diameterMatch) {
    const diameter = parseFloat(diameterMatch[1]);
    if (diameter >= 5.5) {
      analysis.riskLevel = 'high';
      analysis.keyFindings.push(`Large AAA: ${diameter} cm - surgical threshold met`);
      analysis.recommendations.push('Vascular surgery referral for repair evaluation');
      analysis.recommendations.push('CT angiography for surgical planning');
    } else if (diameter >= 4.0) {
      analysis.riskLevel = 'moderate';
      analysis.keyFindings.push(`Medium AAA: ${diameter} cm - surveillance indicated`);
      analysis.recommendations.push('Follow-up ultrasound in 6-12 months');
      analysis.recommendations.push('Smoking cessation, blood pressure control');
    } else if (diameter >= 3.0) {
      analysis.riskLevel = 'low';
      analysis.keyFindings.push(`Small AAA: ${diameter} cm - early surveillance`);
      analysis.recommendations.push('Annual ultrasound surveillance');
    }
  }

  if (analysis.riskLevel === 'normal') {
    analysis.keyFindings.push('Aortic diameter within normal limits');
    analysis.followUp = 'No routine surveillance needed unless risk factors present';
  } else {
    analysis.followUp = analysis.riskLevel === 'high'
      ? 'Urgent vascular surgery consultation'
      : 'Surveillance ultrasound per AAA guidelines';
  }

  return `Aortic ultrasound analysis: ${analysis.riskLevel} risk. ${analysis.keyFindings.length} findings identified.`;
}

function analyzeVenous(measurements, findings, conclusion, analysis) {
  const findingsText = (findings?.toLowerCase() || '') + (conclusion?.toLowerCase() || '');

  if (findingsText.includes('dvt') || findingsText.includes('thrombus') || findingsText.includes('non-compressible')) {
    analysis.riskLevel = 'high';
    analysis.keyFindings.push('Deep vein thrombosis identified');
    analysis.recommendations.push('Anticoagulation therapy as indicated');
    analysis.recommendations.push('Consider IVC filter if anticoagulation contraindicated');
    analysis.followUp = 'Follow-up ultrasound in 3-6 months to assess resolution';
  } else if (findingsText.includes('reflux') || findingsText.includes('insufficiency')) {
    analysis.riskLevel = 'moderate';
    analysis.keyFindings.push('Venous insufficiency/reflux identified');
    analysis.recommendations.push('Compression therapy');
    analysis.recommendations.push('Consider venous ablation if symptomatic');
  } else {
    analysis.keyFindings.push('No DVT identified, veins compressible');
    analysis.followUp = 'Clinical follow-up as needed';
  }

  return `Venous duplex analysis: ${analysis.riskLevel} risk. ${analysis.keyFindings.length} findings identified.`;
}

function analyzeArterial(measurements, findings, conclusion, analysis) {
  const measurementText = measurements?.toLowerCase() || '';
  const findingsText = findings?.toLowerCase() || '';

  const abiMatch = measurementText.match(/abi.*?(\d+\.?\d*)/i);
  if (abiMatch) {
    const abi = parseFloat(abiMatch[1]);
    if (abi < 0.4) {
      analysis.riskLevel = 'high';
      analysis.keyFindings.push(`Severely reduced ABI: ${abi} - critical limb ischemia`);
      analysis.recommendations.push('Urgent vascular surgery consultation');
      analysis.recommendations.push('Consider revascularization');
    } else if (abi < 0.9) {
      analysis.riskLevel = 'moderate';
      analysis.keyFindings.push(`Reduced ABI: ${abi} - peripheral arterial disease`);
      analysis.recommendations.push('Risk factor modification');
      analysis.recommendations.push('Supervised exercise program');
    }
  }

  if (findingsText.includes('occlusion') || findingsText.includes('occluded')) {
    analysis.riskLevel = 'high';
    analysis.keyFindings.push('Arterial occlusion identified');
    analysis.recommendations.push('Vascular surgery evaluation');
  }

  if (analysis.riskLevel === 'normal') {
    analysis.keyFindings.push('No significant arterial disease identified');
    analysis.followUp = 'Clinical follow-up as indicated';
  }

  return `Lower extremity arterial analysis: ${analysis.riskLevel} risk. ${analysis.keyFindings.length} findings identified.`;
}

function suggestCPTCodes(studyType, measurements, findings) {
  const codes = [];
  const studyLower = studyType?.toLowerCase() || '';
  const combinedText = (measurements || '') + (findings || '');

  const isBilateral = combinedText.toLowerCase().includes('bilateral') ||
                      combinedText.toLowerCase().includes('both');

  if (studyLower.includes('carotid')) {
    codes.push(isBilateral ? CPT_CODES.carotid.bilateral : CPT_CODES.carotid.unilateral);
  } else if (studyLower.includes('aorta')) {
    codes.push(CPT_CODES.aorta.complete);
  } else if (studyLower.includes('venous') || studyLower.includes('vein')) {
    codes.push(isBilateral ? CPT_CODES.venous_lower.complete : CPT_CODES.venous_lower.unilateral);
  } else if (studyLower.includes('arterial') || studyLower.includes('artery')) {
    codes.push(isBilateral ? CPT_CODES.arterial_lower.complete : CPT_CODES.arterial_lower.unilateral);
  } else if (studyLower.includes('renal')) {
    codes.push(CPT_CODES.renal.complete);
  }

  return codes;
}

export default router;
