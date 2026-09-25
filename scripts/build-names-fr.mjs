#!/usr/bin/env node
// Generates frontend/src/names/fr.js — French display names for every exercise.
// Upstream only ships English names; we translate with a fitness glossary
// (longest phrases first) so gym vocabulary stays consistent.
//
//   node scripts/build-names-fr.mjs

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dataFile = join(root, 'frontend', 'src', 'lib', 'exercises-data.js')
const outDir = join(root, 'frontend', 'src', 'names')

// Letters that count as "inside a word" (must include accents so FR output isn't re-matched).
const W = 'a-z0-9àâäáéèêëíìîïóòôöúùûüçœæñ°\'’-'

// Longest phrases first after sort. Prefer idiomatic French gym wording.
const PHRASES = {
  // Full common lifts / setups
  '3/4 sit-up': 'redressement assis 3/4',
  'air bike': 'crunch vélo',
  'smith machine': 'smith machine',
  'ez barbell': 'barre EZ',
  'ez-barbell': 'barre EZ',
  'ez-bar': 'barre EZ',
  'olympic barbell': 'barre olympique',
  'heel touchers': 'touchers de talons',
  'bent arm': 'bras fléchi',
  'bent-arm': 'bras fléchi',
  'scapula': 'omoplate',
  'depth jump': 'saut en profondeur',
  'pin presses': 'développés contre pins',
  'pin press': 'développé contre pins',
  'resistance band': 'bande de résistance',
  'bosu ball': 'bosu',
  'stability ball': 'ballon de stabilité',
  'medicine ball': 'medicine ball',
  'exercise ball': 'ballon d’exercice',
  'swiss ball': 'swiss ball',
  'body weight': 'poids du corps',
  'leverage machine': 'machine à levier',
  'sled machine': 'traîneau',
  'trap bar': 'barre trap',
  'hex bar': 'barre hexagonale',
  'v-bar': 'barre en V',
  'tire flip': 'retournement de pneu',
  'farmer walk': 'marche du fermier',
  'farmers walk': 'marche du fermier',
  "farmer's walk": 'marche du fermier',
  'battle ropes': 'cordes ondulatoires',
  'jump rope': 'corde à sauter',
  'skipping rope': 'corde à sauter',

  'bench press': 'développé couché',
  'military press': 'développé militaire',
  'overhead press': 'développé militaire',
  'shoulder press': 'développé épaules',
  'chest press': 'développé poitrine',
  'leg press': 'presse à cuisses',
  'calf press': 'presse mollets',
  'push press': 'push press',
  'push jerk': 'push jerk',
  'french press': 'barre au front',

  'close-grip': 'prise serrée',
  'close grip': 'prise serrée',
  'wide-grip': 'prise large',
  'wide grip': 'prise large',
  'underhand grip': 'prise en supination',
  'overhand grip': 'prise en pronation',
  'neutral grip': 'prise neutre',
  'reverse grip': 'prise inversée',
  'mixed grip': 'prise mixte',
  'hammer grip': 'prise marteau',

  'push-up': 'pompe',
  'push up': 'pompe',
  'pull-up': 'traction',
  'pull up': 'traction',
  'chin-up': 'chin-up',
  'chin up': 'chin-up',
  'sit-up': 'redressement assis',
  'sit up': 'redressement assis',
  'handstand push-up': 'pompe en équilibre',
  'pike push-up': 'pompe pike',
  'decline push-up': 'pompe déclinée',
  'incline push-up': 'pompe inclinée',
  'diamond push-up': 'pompe diamant',
  'clap push-up': 'pompe claquée',
  'muscle up': 'muscle-up',
  'muscle-up': 'muscle-up',
  'inverted row': 'row inversé',
  'australian pull-up': 'traction australienne',

  'romanian deadlift': 'soulevé de terre roumain',
  'sumo deadlift': 'soulevé de terre sumo',
  'stiff-leg deadlift': 'soulevé de terre jambes tendues',
  'stiff leg deadlift': 'soulevé de terre jambes tendues',
  'deadlift': 'soulevé de terre',

  'bulgarian split squat': 'squat bulgare',
  'split squat': 'squat bulgare',
  'goblet squat': 'squat goblet',
  'front squat': 'squat avant',
  'back squat': 'squat arrière',
  'box squat': 'squat sur box',
  'sumo squat': 'squat sumo',
  'hack squat': 'hack squat',
  'pistol squat': 'squat pistolet',
  'sissy squat': 'sissy squat',
  'jump squat': 'squat sauté',
  'wall sit': 'chaise contre le mur',

  'walking lunge': 'fente marchée',
  'reverse lunge': 'fente arrière',
  'lateral lunge': 'fente latérale',
  'forward lunge': 'fente avant',

  'leg raise': 'relevé de jambes',
  'knee raise': 'relevé de genoux',
  'hanging leg raise': 'relevé de jambes suspendu',
  'hanging knee raise': 'relevé de genoux suspendu',
  'calf raise': 'élévation de mollets',
  'calf raises': 'élévations de mollets',
  'front raise': 'élévation frontale',
  'lateral raise': 'élévation latérale',
  'side raise': 'élévation latérale',
  'side bend': 'flexion latérale',
  'rear delt raise': 'élévation deltoïde postérieur',
  'rear delt': 'deltoïde postérieur',

  'leg curl': 'curl jambes',
  'leg extension': 'extension de jambes',
  'triceps extension': 'extension triceps',
  'biceps curl': 'curl biceps',
  'hammer curl': 'curl marteau',
  'preacher curl': 'curl pupitre',
  'concentration curl': 'curl concentration',
  'wrist curl': 'curl poignets',
  'reverse curl': 'curl inversé',
  'skull crusher': 'barre au front',

  'lat pulldown': 'tirage vertical',
  'pulldown': 'tirage vertical',
  'pull-down': 'tirage vertical',
  'pull down': 'tirage vertical',
  'face pull': 'face pull',
  'upright row': 'tirage vertical menton',
  'bent over row': 'row penché',
  'bent-over row': 'row penché',
  'seated row': 'row assis',
  't-bar row': 'row barre en T',
  't bar row': 'row barre en T',

  'chest fly': 'écarté poitrine',
  'cable fly': 'écarté poulie',
  'pec deck': 'pec deck',

  'hip thrust': 'hip thrust',
  'glute bridge': 'pont fessier',
  'hip bridge': 'pont de hanches',
  'good morning': 'good morning',
  'nordic hamstring': 'curl nordique',
  'nordic curl': 'curl nordique',

  'clean and jerk': 'épaulé-jeté',
  'clean & jerk': 'épaulé-jeté',
  'power clean': 'épaulé puissance',
  'hang clean': 'épaulé hang',
  'snatch': 'arraché',
  'thruster': 'thruster',
  'kettlebell swing': 'swing kettlebell',
  'turkish get-up': 'levé turc',
  'turkish get up': 'levé turc',

  'mountain climber': 'grimpeur',
  'jumping jack': 'jumping jack',
  'high knees': 'montées de genoux',
  'butt kick': 'talons-fesses',
  'box jump': 'saut sur box',
  'broad jump': 'saut en longueur',
  'burpee': 'burpee',
  'plank': 'planche',
  'side plank': 'planche latérale',
  'crunch': 'crunch',
  'reverse crunch': 'crunch inversé',
  'bicycle crunch': 'crunch bicyclette',
  'russian twist': 'russian twist',
  'hyperextension': 'hyperextension',
  'back extension': 'extension du dos',

  'chest dip': 'dip poitrine',
  'triceps dip': 'dip triceps',

  'calf stretch': 'étirement des mollets',
  'hamstring stretch': 'étirement des ischio-jambiers',
  'quad stretch': 'étirement des quadriceps',
  'shoulder stretch': 'étirement des épaules',
  'chest stretch': 'étirement de la poitrine',
  'tricep stretch': 'étirement des triceps',
  'all fours': 'à quatre pattes',
  'on all fours': 'à quatre pattes',

  'one arm': 'un bras',
  'one-arm': 'un bras',
  'single arm': 'un bras',
  'single-arm': 'un bras',
  'single leg': 'une jambe',
  'single-leg': 'une jambe',
  'one leg': 'une jambe',
  'one-leg': 'une jambe',
  'bent over': 'penché',
  'bent-over': 'penché',
  'bent knee': 'genoux fléchis',
  'bent-knee': 'genoux fléchis',
  'straight leg': 'jambes tendues',
  'straight-leg': 'jambes tendues',
  'straight arm': 'bras tendus',
  'straight-arm': 'bras tendus',
  'arms overhead': 'bras au-dessus de la tête',
  'arms apart': 'bras écartés',
  'behind the back': 'derrière le dos',
  'behind neck': 'derrière la nuque',
  'behind the neck': 'derrière la nuque',
  'on floor': 'au sol',
  'on the floor': 'au sol',
  'on bench': 'sur banc',
  'on a bench': 'sur banc',
  'shoulder-width': 'largeur d’épaules',
  'shoulder width': 'largeur d’épaules',
  'cross body': 'croisé',
  'cross-body': 'croisé',
  'across body': 'croisé',
  'around the world': 'tour du monde',
  'step-up': 'step-up',
  'step up': 'step-up',
  'step-down': 'step-down',
  'step down': 'step-down',
  'pull-through': 'pull-through',
  'pull through': 'pull-through',
  'pushdown': 'pushdown',
  'push-down': 'pushdown',
  'kickback': 'kickback',
  'pullover': 'pullover',
  'shrug': 'haussement d’épaules',
  'shrugs': 'haussements d’épaules',

  // positions / modifiers
  'lying': 'allongé',
  'seated': 'assis',
  'standing': 'debout',
  'kneeling': 'à genoux',
  'prone': 'à plat ventre',
  'supine': 'sur le dos',
  'incline': 'incliné',
  'decline': 'décliné',
  'overhead': 'au-dessus de la tête',
  'alternate': 'alterné',
  'alternating': 'alterné',
  'assisted': 'assisté',
  'weighted': 'lesté',
  'reverse': 'inversé',
  'lateral': 'latéral',
  'circular': 'circulaire',
  'isometric': 'isométrique',

  // equipment singles
  'dumbbell': 'haltère',
  'barbell': 'barre',
  'cable': 'poulie',
  'kettlebell': 'kettlebell',
  'band': 'élastique',
  'rope': 'corde',
  'sled': 'traîneau',
  'tire': 'pneu',
  'roller': 'rouleau',
  'wheel': 'rouleau',
  'lever': 'machine à levier',
  'smith': 'smith',
  'hammer': 'marteau',
  'preacher': 'pupitre',
  'ez': 'EZ',
  'bosu': 'bosu',

  // body parts / muscles
  'glute': 'fessier',
  'glutes': 'fessiers',
  'hamstring': 'ischio-jambiers',
  'hamstrings': 'ischio-jambiers',
  'quad': 'quadriceps',
  'quads': 'quadriceps',
  'calf': 'mollet',
  'calves': 'mollets',
  'thigh': 'cuisse',
  'thighs': 'cuisses',
  'hip': 'hanche',
  'hips': 'hanches',
  'knee': 'genou',
  'knees': 'genoux',
  'ankle': 'cheville',
  'ankles': 'chevilles',
  'heel': 'talon',
  'heels': 'talons',
  'toe': 'orteil',
  'toes': 'orteils',
  'foot': 'pied',
  'feet': 'pieds',
  'leg': 'jambe',
  'legs': 'jambes',
  'chest': 'poitrine',
  'shoulder': 'épaule',
  'shoulders': 'épaules',
  'delt': 'deltoïde',
  'delts': 'deltoïdes',
  'trap': 'trapèze',
  'traps': 'trapèzes',
  'lats': 'grands dorsaux',
  'lat': 'grand dorsal',
  'spine': 'colonne',
  'core': 'gainage',
  'abs': 'abdos',
  'oblique': 'oblique',
  'obliques': 'obliques',
  'bicep': 'biceps',
  'biceps': 'biceps',
  'tricep': 'triceps',
  'triceps': 'triceps',
  'forearm': 'avant-bras',
  'forearms': 'avant-bras',
  'wrist': 'poignet',
  'wrists': 'poignets',
  'arm': 'bras',
  'arms': 'bras',
  'hand': 'main',
  'hands': 'mains',
  'neck': 'cou',
  'head': 'tête',
  'torso': 'torse',
  'waist': 'taille',
  'back': 'dos',
  'front': 'avant',
  'rear': 'arrière',
  'side': 'côté',
  'upper': 'supérieur',
  'lower': 'inférieur',
  'inner': 'interne',
  'outer': 'externe',
  'middle': 'milieu',

  // verbs / actions left as gym loanwords where FR keeps them
  'squat': 'squat',
  'squats': 'squats',
  'lunge': 'fente',
  'lunges': 'fentes',
  'press': 'développé',
  'curl': 'curl',
  'row': 'row',
  'fly': 'écarté',
  'flies': 'écartés',
  'flye': 'écarté',
  'raise': 'élévation',
  'raises': 'élévations',
  'extension': 'extension',
  'flexion': 'flexion',
  'abduction': 'abduction',
  'adduction': 'adduction',
  'twist': 'torsion',
  'twisting': 'avec torsion',
  'rotation': 'rotation',
  'circle': 'cercle',
  'circles': 'cercles',
  'jump': 'saut',
  'jumps': 'sauts',
  'swing': 'swing',
  'swings': 'swings',
  'dip': 'dip',
  'stretch': 'étirement',
  'stretching': 'étirement',
  'hold': 'maintien',
  'carry': 'porté',
  'walk': 'marche',
  'run': 'course',
  'sprint': 'sprint',
  'climb': 'grimpe',
  'crawl': 'rampé',
  'push': 'poussée',
  'pull': 'tirage',
  'lift': 'levé',
  'kick': 'coup de pied',

  // misc
  'exercise': 'exercice',
  'machine': 'machine',
  'bench': 'banc',
  'floor': 'sol',
  'wall': 'mur',
  'box': 'box',
  'ball': 'ballon',
  'bar': 'barre',
  'pad': 'coussin',
  'grip': 'prise',
  'narrow': 'serré',
  'wide': 'large',
  'close': 'serré',
  'high': 'haut',
  'low': 'bas',
  'full': 'complet',
  'half': 'demi',
  'partial': 'partiel',
  'male': 'homme',
  'female': 'femme',
  'version': 'version',
  'variation': 'variante',
  'with': 'avec',
  'without': 'sans',
  'and': 'et',
  'or': 'ou',
  'on': 'sur',
  'in': 'en',
  'of': 'de',
  'to': 'vers',
  'from': 'depuis',
  'for': 'pour',
  'over': 'par-dessus',
  'under': 'par-dessous',
  'across': 'en travers',
  'between': 'entre',
  'against': 'contre',
  'using': 'avec',
  'both': 'les deux',
  'each': 'chaque',
  'two': 'deux',
  'three': 'trois',
  'four': 'quatre',
}

const SKIP = new Set(['the', 'a', 'an', 'your', 'per'])

const ORDERED = Object.entries(PHRASES).sort((a, b) => b[0].length - a[0].length)

const EQUIP_FR = [
  'haltère', 'barre EZ', 'barre olympique', 'barre trap', 'barre hexagonale', 'barre',
  'poulie', 'kettlebell', 'élastique', 'bande de résistance', 'smith machine',
  'machine à levier', 'medicine ball', 'ballon de stabilité', 'ballon d’exercice',
  'bosu', 'corde', 'traîneau', 'rouleau', 'poids du corps'
].sort((a, b) => b.length - a.length)

function esc(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function translateName(en) {
  let s = ' ' + en.toLowerCase().trim() + ' '
  for (const [enPhrase, fr] of ORDERED) {
    const re = new RegExp('(^|[^' + W + '])' + esc(enPhrase) + '([^' + W + ']|$)', 'gi')
    s = s.replace(re, (_, a, b) => a + fr + b)
  }
  // Drop leftover English articles
  for (const w of SKIP) {
    const re = new RegExp('(^|[^' + W + '])' + w + '([^' + W + ']|$)', 'gi')
    s = s.replace(re, (_, a, b) => a + b)
  }
  s = s.replace(/\s+/g, ' ').trim()
  if (!s) return en

  // Prefer FR word order: move leading equipment to the end ("haltère curl" → "curl haltère")
  for (const eq of EQUIP_FR) {
    if (s === eq) break
    if (s.startsWith(eq + ' ')) {
      s = s.slice(eq.length).trim() + ' ' + eq
      break
    }
  }
  return s
}

const src = readFileSync(dataFile, 'utf8')
const pairs = [...src.matchAll(/\{"id":"([^"]+)","n":"((?:\\.|[^"\\])*)"/g)].map(m => [m[1], m[2]])
if (pairs.length < 1000) throw new Error('Expected ~1324 exercises, got ' + pairs.length)

const pack = {}
for (const [id, n] of pairs) pack[id] = translateName(n)

mkdirSync(outDir, { recursive: true })
const out = join(outDir, 'fr.js')
writeFileSync(out, '// generated by scripts/build-names-fr.mjs — do not edit\nexport default ' + JSON.stringify(pack) + '\n')
console.log(`${out}: ${Object.keys(pack).length} names`)
const samples = ['0001', '0002', '0003', '0025', '0031', '0043', '0006', '0007', '0024', '0160']
for (const id of samples) {
  const en = pairs.find(p => p[0] === id)
  if (en) console.log(`  ${id}: ${en[1]} → ${pack[id]}`)
}
