import fs from 'node:fs';
import path from 'node:path';

const LEVEL_TARGETS = {
  A1: 84,
  A2: 84,
  B1: 83,
  B2: 83,
  C1: 83,
  C2: 83,
};

const LEVEL_ORDER = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

const LEVEL_CONTEXTS = {
  A1: ['for everyday routines', 'for a school dialogue', 'for a family conversation', 'for a travel phrasebook'],
  A2: ['in a practical daily context', 'in a simple workplace context', 'in a weekend conversation', 'in a short story context'],
  B1: ['in a workplace scenario', 'in an interview scenario', 'in a study-group scenario', 'in a project scenario'],
  B2: ['in a professional communication context', 'in a policy discussion context', 'in an analytical report context', 'in a decision-making context'],
  C1: ['in an academic discussion context', 'in a strategic planning context', 'in a high-stakes communication context', 'in an evidence-based argument context'],
  C2: ['in an expert-level policy context', 'in a legal-analytical context', 'in a nuanced editorial context', 'in a complex negotiation context'],
};

function decorateQuestion(level, question, localIndex) {
  const variantBlock = Math.floor(localIndex / 10);
  if (variantBlock === 0) return question;
  const contexts = LEVEL_CONTEXTS[level] || [];
  if (contexts.length === 0) return question;
  const context = contexts[(variantBlock - 1) % contexts.length];
  return `${question} (${context})`;
}

function createQuestion(level, question, correct, wrongOptions) {
  const options = [correct, ...wrongOptions].map((v) => String(v).trim());
  const uniqueOptions = [...new Set(options)];
  if (uniqueOptions.length !== 4) {
    return null;
  }

  const rotation = question.length % 4;
  const rotated = [...uniqueOptions.slice(rotation), ...uniqueOptions.slice(0, rotation)];
  const correctIndex = rotated.indexOf(correct);
  if (correctIndex < 0) {
    return null;
  }

  return {
    level,
    question: String(question).trim(),
    options: rotated,
    correct_option: correctIndex,
  };
}

function buildLevel(level, target, templateFns, globalUsed) {
  const levelQuestions = [];
  let i = 0;
  const templateCounters = new Array(templateFns.length).fill(0);
  let guard = 0;

  while (levelQuestions.length < target) {
    guard += 1;
    if (guard > 200000) {
      throw new Error(`Failed to generate enough unique questions for ${level}`);
    }

    const templateIndex = i % templateFns.length;
    const template = templateFns[templateIndex];
    const localIndex = templateCounters[templateIndex];
    templateCounters[templateIndex] += 1;
    const candidate = template(localIndex);
    i += 1;

    if (!candidate || !candidate.question) {
      continue;
    }

    candidate.question = decorateQuestion(level, candidate.question, localIndex);

    const normalizedKey = `${level}::${candidate.question.toLowerCase()}`;
    if (globalUsed.has(normalizedKey)) {
      continue;
    }

    if (!Array.isArray(candidate.options) || candidate.options.length !== 4) {
      continue;
    }

    const uniqueOptions = new Set(candidate.options.map((v) => String(v).trim().toLowerCase()));
    if (uniqueOptions.size !== 4) {
      continue;
    }

    if (candidate.correct_option < 0 || candidate.correct_option > 3) {
      continue;
    }

    levelQuestions.push(candidate);
    globalUsed.add(normalizedKey);
  }

  return levelQuestions;
}

function buildTemplates() {
  const templates = {};

  const verbs = [
    { base: 'go', third: 'goes', ing: 'going' },
    { base: 'study', third: 'studies', ing: 'studying' },
    { base: 'watch', third: 'watches', ing: 'watching' },
    { base: 'play', third: 'plays', ing: 'playing' },
    { base: 'work', third: 'works', ing: 'working' },
    { base: 'read', third: 'reads', ing: 'reading' },
    { base: 'cook', third: 'cooks', ing: 'cooking' },
    { base: 'walk', third: 'walks', ing: 'walking' },
    { base: 'drink', third: 'drinks', ing: 'drinking' },
    { base: 'drive', third: 'drives', ing: 'driving' },
    { base: 'clean', third: 'cleans', ing: 'cleaning' },
    { base: 'open', third: 'opens', ing: 'opening' },
    { base: 'close', third: 'closes', ing: 'closing' },
    { base: 'call', third: 'calls', ing: 'calling' },
  ];

  const routineSubjects = [
    'She',
    'He',
    'My brother',
    'Anna',
    'The teacher',
    'Tom',
    'My mother',
    'Our manager',
    'The student',
    'My neighbor',
    'The doctor',
    'My friend',
    'The chef',
    'The driver',
  ];

  const routineTails = [
    'to school every day',
    'English in the evening',
    'TV after dinner',
    'tennis on Sundays',
    'in an office near the station',
    'a newspaper every morning',
    'dinner for the family',
    'to the park with her dog',
    'water at breakfast',
    'to work at 8 a.m.',
    'the classroom after lessons',
    'the shop at 9 a.m.',
    'the door before leaving',
    'his cousin every weekend',
  ];

  const beSubjects = [
    { subject: 'I', correct: 'am', wrong: ['is', 'are', 'be'] },
    { subject: 'You', correct: 'are', wrong: ['am', 'is', 'be'] },
    { subject: 'She', correct: 'is', wrong: ['am', 'are', 'be'] },
    { subject: 'He', correct: 'is', wrong: ['am', 'are', 'be'] },
    { subject: 'We', correct: 'are', wrong: ['am', 'is', 'be'] },
    { subject: 'They', correct: 'are', wrong: ['am', 'is', 'be'] },
    { subject: 'My sister', correct: 'is', wrong: ['am', 'are', 'be'] },
    { subject: 'The children', correct: 'are', wrong: ['am', 'is', 'be'] },
    { subject: 'Our teacher', correct: 'is', wrong: ['am', 'are', 'be'] },
    { subject: 'My parents', correct: 'are', wrong: ['am', 'is', 'be'] },
  ];

  const beTails = [
    'from Italy',
    'in the classroom now',
    'very tired today',
    'at home this evening',
    'ready for the lesson',
    'happy with the result',
    'late again',
    'in the kitchen',
    'good at math',
    'near the station',
  ];

  const prepositionSet = [
    { q: 'Choose the correct preposition: "The keys are ___ the table."', c: 'on', w: ['in', 'at', 'under'] },
    { q: 'Choose the correct preposition: "We have English class ___ Monday."', c: 'on', w: ['in', 'at', 'from'] },
    { q: 'Choose the correct preposition: "She gets up ___ 7 o\'clock."', c: 'at', w: ['in', 'on', 'to'] },
    { q: 'Choose the correct preposition: "The milk is ___ the fridge."', c: 'in', w: ['on', 'at', 'over'] },
    { q: 'Choose the correct preposition: "They live ___ a small town."', c: 'in', w: ['on', 'at', 'to'] },
    { q: 'Choose the correct preposition: "I usually go home ___ night."', c: 'at', w: ['in', 'on', 'by'] },
    { q: 'Choose the correct preposition: "The cat is ___ the chair."', c: 'under', w: ['in', 'at', 'for'] },
    { q: 'Choose the correct preposition: "Our office is ___ the second floor."', c: 'on', w: ['in', 'at', 'by'] },
    { q: 'Choose the correct preposition: "He arrived ___ the airport at noon."', c: 'at', w: ['in', 'on', 'to'] },
    { q: 'Choose the correct preposition: "My birthday is ___ June."', c: 'in', w: ['on', 'at', 'to'] },
  ];

  const irregularPast = [
    { base: 'eat', past: 'ate', wrong: ['eated', 'eaten', 'eat'] },
    { base: 'go', past: 'went', wrong: ['goed', 'gone', 'go'] },
    { base: 'see', past: 'saw', wrong: ['seed', 'seen', 'see'] },
    { base: 'buy', past: 'bought', wrong: ['buyed', 'brought', 'buy'] },
    { base: 'take', past: 'took', wrong: ['taked', 'taken', 'take'] },
    { base: 'write', past: 'wrote', wrong: ['writed', 'written', 'write'] },
    { base: 'speak', past: 'spoke', wrong: ['speaked', 'spoken', 'speak'] },
    { base: 'give', past: 'gave', wrong: ['gived', 'given', 'give'] },
    { base: 'find', past: 'found', wrong: ['finded', 'founded', 'find'] },
    { base: 'drink', past: 'drank', wrong: ['drinked', 'drunk', 'drink'] },
  ];

  const whQuestions = [
    { q: 'Choose the correct question word: "___ is your favorite color?"', c: 'What', w: ['Who', 'Where', 'When'] },
    { q: 'Choose the correct question word: "___ do you live?"', c: 'Where', w: ['Who', 'Why', 'How many'] },
    { q: 'Choose the correct question word: "___ old are you?"', c: 'How', w: ['What', 'Where', 'When'] },
    { q: 'Choose the correct question word: "___ is that woman?"', c: 'Who', w: ['What', 'Where', 'How'] },
    { q: 'Choose the correct question word: "___ do you go to bed?"', c: 'When', w: ['Who', 'Where', 'How much'] },
    { q: 'Choose the correct question word: "___ apples do you need?"', c: 'How many', w: ['How much', 'Who', 'When'] },
    { q: 'Choose the correct question word: "___ is your bag, the red one or the blue one?"', c: 'Which', w: ['Who', 'When', 'How'] },
    { q: 'Choose the correct question word: "___ are you late today?"', c: 'Why', w: ['Where', 'How many', 'Who'] },
    { q: 'Choose the correct question word: "___ is your birthday, in May or June?"', c: 'When', w: ['Why', 'Who', 'How much'] },
    { q: 'Choose the correct question word: "___ do you usually get to work?"', c: 'How', w: ['Who', 'Where', 'Which color'] },
  ];

  const pluralSet = [
    { singular: 'child', plural: 'children', wrong: ['childs', 'childes', 'childrens'] },
    { singular: 'tooth', plural: 'teeth', wrong: ['tooths', 'teeths', 'toothes'] },
    { singular: 'man', plural: 'men', wrong: ['mans', 'mens', 'manes'] },
    { singular: 'woman', plural: 'women', wrong: ['womans', 'womens', 'womanes'] },
    { singular: 'mouse', plural: 'mice', wrong: ['mouses', 'mices', 'mouse'] },
    { singular: 'foot', plural: 'feet', wrong: ['foots', 'feets', 'footes'] },
    { singular: 'person', plural: 'people', wrong: ['persons', 'peoples', 'persons'] },
    { singular: 'leaf', plural: 'leaves', wrong: ['leafs', 'leafes', 'leave'] },
    { singular: 'city', plural: 'cities', wrong: ['citys', 'cityes', 'citis'] },
    { singular: 'box', plural: 'boxes', wrong: ['boxs', 'boxies', 'box'] },
  ];

  templates.A1 = [
    (i) => {
      const subject = routineSubjects[i % routineSubjects.length];
      const verb = verbs[Math.floor(i / routineSubjects.length) % verbs.length];
      const tail = routineTails[(i + Math.floor(i / 3)) % routineTails.length];
      return createQuestion('A1', `Choose the correct verb form: "${subject} ___ ${tail}."`, verb.third, [verb.base, verb.ing, `to ${verb.base}`]);
    },
    (i) => {
      const subj = beSubjects[i % beSubjects.length];
      const tail = beTails[Math.floor(i / beSubjects.length) % beTails.length];
      return createQuestion('A1', `Complete the sentence: "${subj.subject} ___ ${tail}."`, subj.correct, subj.wrong);
    },
    (i) => {
      const item = prepositionSet[i % prepositionSet.length];
      return createQuestion('A1', item.q, item.c, item.w);
    },
    (i) => {
      const item = irregularPast[i % irregularPast.length];
      return createQuestion('A1', `What is the past tense of "${item.base}"?`, item.past, item.wrong);
    },
    (i) => {
      const item = whQuestions[i % whQuestions.length];
      return createQuestion('A1', item.q, item.c, item.w);
    },
    (i) => {
      const item = pluralSet[i % pluralSet.length];
      return createQuestion('A1', `Choose the correct plural form of "${item.singular}".`, item.plural, item.wrong);
    },
  ];

  const comparativeSet = [
    { adjective: 'good', correct: 'better', wrong: ['gooder', 'more good', 'best'] },
    { adjective: 'bad', correct: 'worse', wrong: ['badder', 'more bad', 'worst'] },
    { adjective: 'fast', correct: 'faster', wrong: ['more fast', 'fastest', 'fastly'] },
    { adjective: 'expensive', correct: 'more expensive', wrong: ['expensiver', 'most expensive', 'more expensiver'] },
    { adjective: 'easy', correct: 'easier', wrong: ['more easy', 'easyer', 'easiest'] },
    { adjective: 'comfortable', correct: 'more comfortable', wrong: ['comfortabler', 'most comfortable', 'more comfortabler'] },
    { adjective: 'cheap', correct: 'cheaper', wrong: ['more cheap', 'cheapest', 'cheaply'] },
    { adjective: 'interesting', correct: 'more interesting', wrong: ['interestinger', 'most interesting', 'more interestinger'] },
    { adjective: 'quiet', correct: 'quieter', wrong: ['more quiet', 'quietest', 'quietly'] },
    { adjective: 'far', correct: 'farther', wrong: ['more far', 'farthest', 'furthermost'] },
  ];

  const perfectForSince = [
    { q: 'Complete: "I have lived here ___ 2019."', c: 'since', w: ['for', 'from', 'during'] },
    { q: 'Complete: "She has worked there ___ five years."', c: 'for', w: ['since', 'from', 'by'] },
    { q: 'Complete: "We have known each other ___ childhood."', c: 'since', w: ['for', 'during', 'at'] },
    { q: 'Complete: "They have been married ___ ten years."', c: 'for', w: ['since', 'from', 'at'] },
    { q: 'Complete: "He has studied English ___ last September."', c: 'since', w: ['for', 'during', 'by'] },
    { q: 'Complete: "I have waited ___ two hours."', c: 'for', w: ['since', 'from', 'overly'] },
    { q: 'Complete: "She has had this phone ___ 2023."', c: 'since', w: ['for', 'during', 'to'] },
    { q: 'Complete: "We have used this method ___ months."', c: 'for', w: ['since', 'from', 'at'] },
    { q: 'Complete: "My parents have lived in Paris ___ 2010."', c: 'since', w: ['for', 'during', 'about'] },
    { q: 'Complete: "I have practiced piano ___ a long time."', c: 'for', w: ['since', 'from', 'when'] },
  ];

  const pastSimpleSet = [
    { q: 'Choose the correct option: "Yesterday we ___ to the museum."', c: 'went', w: ['go', 'gone', 'going'] },
    { q: 'Choose the correct option: "She ___ dinner at 7 p.m. last night."', c: 'cooked', w: ['cook', 'has cooked', 'cooks'] },
    { q: 'Choose the correct option: "I ___ him at the station this morning."', c: 'met', w: ['meet', 'have met', 'meeting'] },
    { q: 'Choose the correct option: "They ___ TV after school yesterday."', c: 'watched', w: ['watch', 'have watched', 'watching'] },
    { q: 'Choose the correct option: "He ___ a new laptop last month."', c: 'bought', w: ['buy', 'has bought', 'buying'] },
    { q: 'Choose the correct option: "Last weekend we ___ tennis in the park."', c: 'played', w: ['play', 'have played', 'playing'] },
    { q: 'Choose the correct option: "My sister ___ me an email yesterday."', c: 'sent', w: ['send', 'has sent', 'sending'] },
    { q: 'Choose the correct option: "The lesson ___ at 9 a.m. yesterday."', c: 'started', w: ['start', 'has started', 'starting'] },
    { q: 'Choose the correct option: "I ___ very tired after the trip."', c: 'felt', w: ['feel', 'have felt', 'feeling'] },
    { q: 'Choose the correct option: "She ___ her keys on the table."', c: 'left', w: ['leave', 'has left', 'leaving'] },
  ];

  const modalAdviceSet = [
    { q: 'Choose the best advice: "You have a headache. You ___ drink some water."', c: 'should', w: ['mustn\'t', 'can\'t', 'don\'t have to'] },
    { q: 'Choose the best advice: "It\'s cold outside. You ___ wear a coat."', c: 'should', w: ['shouldn\'t', 'can\'t', 'mustn\'t'] },
    { q: 'Choose the best advice: "You are tired. You ___ go to bed early."', c: 'should', w: ['mustn\'t', 'can\'t', 'don\'t need'] },
    { q: 'Choose the best advice: "You want to pass the exam. You ___ study every day."', c: 'should', w: ['mustn\'t', 'can\'t', 'shouldn\'t'] },
    { q: 'Choose the best advice: "Your room is messy. You ___ clean it today."', c: 'should', w: ['mustn\'t', 'can\'t', 'shouldn\'t'] },
    { q: 'Choose the best advice: "You have a fever. You ___ see a doctor."', c: 'should', w: ['mustn\'t', 'can\'t', 'don\'t have to'] },
    { q: 'Choose the best advice: "The train leaves at 6. You ___ leave now."', c: 'should', w: ['mustn\'t', 'can\'t', 'shouldn\'t'] },
    { q: 'Choose the best advice: "You feel stressed. You ___ take a short break."', c: 'should', w: ['mustn\'t', 'can\'t', 'shouldn\'t'] },
    { q: 'Choose the best advice: "You are late again. You ___ set an alarm."', c: 'should', w: ['mustn\'t', 'can\'t', 'don\'t need'] },
    { q: 'Choose the best advice: "You are thirsty. You ___ drink some tea."', c: 'should', w: ['mustn\'t', 'can\'t', 'shouldn\'t'] },
  ];

  const phrasalVerbSetA2 = [
    { q: 'Select the correct phrasal verb: "Please ___ your shoes before entering."', c: 'take off', w: ['put off', 'turn on', 'look after'] },
    { q: 'Select the correct phrasal verb: "Can you ___ the lights, please?"', c: 'turn off', w: ['take off', 'look up', 'give up'] },
    { q: 'Select the correct phrasal verb: "I need to ___ this word in the dictionary."', c: 'look up', w: ['turn down', 'pick up', 'run out'] },
    { q: 'Select the correct phrasal verb: "We should ___ early to avoid traffic."', c: 'set off', w: ['give up', 'look after', 'turn off'] },
    { q: 'Select the correct phrasal verb: "Could you ___ me at the airport?"', c: 'pick up', w: ['drop out', 'turn on', 'run into'] },
    { q: 'Select the correct phrasal verb: "I can\'t hear you. Please ___ the volume."', c: 'turn up', w: ['turn down', 'take off', 'look for'] },
    { q: 'Select the correct phrasal verb: "Don\'t ___! Keep trying."', c: 'give up', w: ['set off', 'look up', 'pick up'] },
    { q: 'Select the correct phrasal verb: "She ___ her little brother after school."', c: 'looks after', w: ['takes off', 'turns off', 'gives up'] },
    { q: 'Select the correct phrasal verb: "I ___ my old friend at the mall yesterday."', c: 'ran into', w: ['looked after', 'set off', 'turned up'] },
    { q: 'Select the correct phrasal verb: "We have ___ milk. Let\'s buy some."', c: 'run out of', w: ['looked up', 'set off', 'taken off'] },
  ];

  const quantifierSet = [
    { q: 'Choose the correct word: "How ___ sugar do you need?"', c: 'much', w: ['many', 'few', 'a few'] },
    { q: 'Choose the correct word: "How ___ students are in your class?"', c: 'many', w: ['much', 'little', 'less'] },
    { q: 'Choose the correct word: "There are ___ apples in the basket."', c: 'a few', w: ['a little', 'much', 'less'] },
    { q: 'Choose the correct word: "I have ___ time today, so I can help you."', c: 'a little', w: ['a few', 'many', 'much of'] },
    { q: 'Choose the correct word: "There is ___ water left in the bottle."', c: 'little', w: ['few', 'many', 'a lot of many'] },
    { q: 'Choose the correct word: "Only ___ people came to the meeting."', c: 'a few', w: ['a little', 'much', 'less'] },
    { q: 'Choose the correct word: "We don\'t have ___ money right now."', c: 'much', w: ['many', 'a few', 'little of'] },
    { q: 'Choose the correct word: "There are too ___ mistakes in this text."', c: 'many', w: ['much', 'little', 'fewest'] },
    { q: 'Choose the correct word: "Could I have ___ milk in my coffee?"', c: 'a little', w: ['a few', 'many', 'much of'] },
    { q: 'Choose the correct word: "Very ___ information was available."', c: 'little', w: ['few', 'many', 'a few'] },
  ];

  templates.A2 = [
    (i) => {
      const item = comparativeSet[i % comparativeSet.length];
      return createQuestion('A2', `Choose the correct comparative form of "${item.adjective}".`, item.correct, item.wrong);
    },
    (i) => {
      const item = perfectForSince[i % perfectForSince.length];
      return createQuestion('A2', item.q, item.c, item.w);
    },
    (i) => {
      const item = pastSimpleSet[i % pastSimpleSet.length];
      return createQuestion('A2', item.q, item.c, item.w);
    },
    (i) => {
      const item = modalAdviceSet[i % modalAdviceSet.length];
      return createQuestion('A2', item.q, item.c, item.w);
    },
    (i) => {
      const item = phrasalVerbSetA2[i % phrasalVerbSetA2.length];
      return createQuestion('A2', item.q, item.c, item.w);
    },
    (i) => {
      const item = quantifierSet[i % quantifierSet.length];
      return createQuestion('A2', item.q, item.c, item.w);
    },
  ];

  const conditionalSet = [
    { q: 'Complete the second conditional: "If I ___ more time, I would learn Japanese."', c: 'had', w: ['have', 'will have', 'would have'] },
    { q: 'Complete the second conditional: "If she ___ closer, she would walk to work."', c: 'lived', w: ['lives', 'has lived', 'would live'] },
    { q: 'Complete the second conditional: "If we ___ a car, we would drive to the coast."', c: 'had', w: ['have', 'would have', 'will have'] },
    { q: 'Complete the second conditional: "If he ___ harder, he would pass the exam."', c: 'studied', w: ['studies', 'would study', 'has studied'] },
    { q: 'Complete the second conditional: "If they ___ enough money, they would move abroad."', c: 'saved', w: ['save', 'would save', 'are saving'] },
    { q: 'Complete the second conditional: "If I ___ you, I would apologize."', c: 'were', w: ['am', 'was', 'be'] },
    { q: 'Complete the second conditional: "If my phone ___ better, I would use this app."', c: 'worked', w: ['works', 'would work', 'is working'] },
    { q: 'Complete the second conditional: "If she ___ free, she would join us tonight."', c: 'were', w: ['is', 'was', 'will be'] },
    { q: 'Complete the second conditional: "If the weather ___ nicer, we would have a picnic."', c: 'were', w: ['is', 'was', 'has been'] },
    { q: 'Complete the second conditional: "If I ___ French, I would apply for that job."', c: 'spoke', w: ['speak', 'am speaking', 'would speak'] },
  ];

  const passiveSet = [
    { q: 'Choose the correct passive form: "The report ___ by the team yesterday."', c: 'was prepared', w: ['prepared', 'is preparing', 'was prepare'] },
    { q: 'Choose the correct passive form: "English ___ in many countries."', c: 'is spoken', w: ['speaks', 'is speaking', 'spoke'] },
    { q: 'Choose the correct passive form: "The new bridge ___ next year."', c: 'will be opened', w: ['will open', 'is opening', 'opens'] },
    { q: 'Choose the correct passive form: "Dinner ___ when we arrived."', c: 'was being served', w: ['served', 'is served', 'was serving'] },
    { q: 'Choose the correct passive form: "The room ___ every day."', c: 'is cleaned', w: ['cleans', 'is cleaning', 'cleaned is'] },
    { q: 'Choose the correct passive form: "The documents ___ already ___."', c: 'have / been signed', w: ['have / signed', 'are / signed', 'were / signing'] },
    { q: 'Choose the correct passive form: "A new policy ___ soon."', c: 'will be announced', w: ['will announce', 'is announce', 'announces'] },
    { q: 'Choose the correct passive form: "The package ___ to your office tomorrow."', c: 'will be delivered', w: ['will deliver', 'delivers', 'is delivering'] },
    { q: 'Choose the correct passive form: "The windows ___ every weekend."', c: 'are washed', w: ['wash', 'are washing', 'were wash'] },
    { q: 'Choose the correct passive form: "The contract ___ before the deadline."', c: 'was signed', w: ['signed', 'is signing', 'was sign'] },
  ];

  const reportedSpeechSet = [
    { q: 'Choose the correct reported speech: "I am tired," she said.', c: 'She said that she was tired.', w: ['She said that she is tired.', 'She said she tired.', 'She said that I was tired.'] },
    { q: 'Choose the correct reported speech: "We will call you," they said.', c: 'They said that they would call me.', w: ['They said they will call me.', 'They said that we would call you.', 'They said would call me.'] },
    { q: 'Choose the correct reported speech: "I have finished," he said.', c: 'He said that he had finished.', w: ['He said he has finished.', 'He said that he finished has.', 'He said that I had finished.'] },
    { q: 'Choose the correct reported speech: "I can help," Anna said.', c: 'Anna said that she could help.', w: ['Anna said she can help.', 'Anna said that she helps could.', 'Anna said that I could help.'] },
    { q: 'Choose the correct reported speech: "Do you like coffee?" she asked.', c: 'She asked if I liked coffee.', w: ['She asked do I like coffee.', 'She asked if I like coffee.', 'She asked I liked coffee?'] },
    { q: 'Choose the correct reported speech: "Where do you live?" he asked.', c: 'He asked where I lived.', w: ['He asked where do I live.', 'He asked where I live.', 'He asked where lived I.'] },
    { q: 'Choose the correct reported speech: "I met him yesterday," she said.', c: 'She said that she had met him the day before.', w: ['She said she met him yesterday.', 'She said she had met him yesterday.', 'She said that she met him the day before.'] },
    { q: 'Choose the correct reported speech: "I will be late," he said.', c: 'He said that he would be late.', w: ['He said he will be late.', 'He said he was late.', 'He said would be late.'] },
    { q: 'Choose the correct reported speech: "Please sit down," the teacher said.', c: 'The teacher told us to sit down.', w: ['The teacher said sit down.', 'The teacher asked if we sit down.', 'The teacher told that sit down.'] },
    { q: 'Choose the correct reported speech: "Don\'t touch that," she said.', c: 'She told me not to touch that.', w: ['She said me don\'t touch that.', 'She told me to not touch that not.', 'She asked me not touch that.'] },
  ];

  const gerundInfSet = [
    { q: 'Choose the correct form: "I enjoy ___ novels in the evening."', c: 'reading', w: ['to read', 'read', 'reads'] },
    { q: 'Choose the correct form: "He decided ___ abroad."', c: 'to study', w: ['studying', 'study', 'studied'] },
    { q: 'Choose the correct form: "They avoided ___ about politics."', c: 'talking', w: ['to talk', 'talk', 'talked'] },
    { q: 'Choose the correct form: "She promised ___ me later."', c: 'to call', w: ['calling', 'call', 'called'] },
    { q: 'Choose the correct form: "We can\'t afford ___ a new car now."', c: 'to buy', w: ['buying', 'buy', 'bought'] },
    { q: 'Choose the correct form: "I\'m looking forward to ___ you."', c: 'seeing', w: ['to see', 'see', 'saw'] },
    { q: 'Choose the correct form: "He refused ___ the offer."', c: 'to accept', w: ['accepting', 'accept', 'accepted'] },
    { q: 'Choose the correct form: "She suggested ___ a taxi."', c: 'taking', w: ['to take', 'take', 'took'] },
    { q: 'Choose the correct form: "I hope ___ this project soon."', c: 'to finish', w: ['finishing', 'finish', 'finished'] },
    { q: 'Choose the correct form: "They admitted ___ the mistake."', c: 'making', w: ['to make', 'make', 'made'] },
  ];

  const relativeSet = [
    { q: 'Choose the correct relative pronoun: "The woman ___ lives next door is a lawyer."', c: 'who', w: ['which', 'where', 'whose'] },
    { q: 'Choose the correct relative pronoun: "The book ___ I bought is fascinating."', c: 'that', w: ['who', 'whose', 'where'] },
    { q: 'Choose the correct relative pronoun: "The city ___ I was born is very old."', c: 'where', w: ['who', 'which one person', 'whose'] },
    { q: 'Choose the correct relative pronoun: "The boy ___ bike was stolen is upset."', c: 'whose', w: ['who', 'which', 'where'] },
    { q: 'Choose the correct relative pronoun: "The movie ___ we watched was great."', c: 'that', w: ['who', 'whose', 'where'] },
    { q: 'Choose the correct relative pronoun: "The teacher ___ helped me was patient."', c: 'who', w: ['which', 'where', 'whose'] },
    { q: 'Choose the correct relative pronoun: "The office ___ she works is downtown."', c: 'where', w: ['who', 'whose', 'which person'] },
    { q: 'Choose the correct relative pronoun: "The man ___ car is outside is my uncle."', c: 'whose', w: ['who', 'that where', 'which'] },
    { q: 'Choose the correct relative pronoun: "The song ___ is playing is my favorite."', c: 'that', w: ['who', 'whose', 'where'] },
    { q: 'Choose the correct relative pronoun: "The student ___ answered was correct."', c: 'who', w: ['which', 'where', 'whose'] },
  ];

  const discourseSetB1 = [
    { q: 'Choose the best linker: "I was tired; ___, I finished the report."', c: 'nevertheless', w: ['because', 'for example', 'meanwhile'] },
    { q: 'Choose the best linker: "The weather was bad. ___, we stayed home."', c: 'Therefore', w: ['However', 'For instance', 'Meanwhile'] },
    { q: 'Choose the best linker: "I like tea; ___, my sister prefers coffee."', c: 'whereas', w: ['therefore', 'because', 'moreover not'] },
    { q: 'Choose the best linker: "He studied hard. ___, he failed the exam."', c: 'However', w: ['Therefore', 'As a result', 'Since'] },
    { q: 'Choose the best linker: "We need to save money. ___, we should cancel the trip."', c: 'Thus', w: ['Although', 'Besides why', 'Meanwhile'] },
    { q: 'Choose the best linker: "I was ill. ___, I went to work."', c: 'Even so', w: ['Because', 'As soon as', 'Therefore'] },
    { q: 'Choose the best linker: "She speaks Spanish fluently; ___, she can work in Madrid."', c: 'therefore', w: ['however', 'meanwhile', 'unless'] },
    { q: 'Choose the best linker: "The project is expensive. ___, it is worth it."', c: 'Nevertheless', w: ['Because of', 'Besides this why', 'Until'] },
    { q: 'Choose the best linker: "I wanted to go out; ___, it started raining."', c: 'unfortunately', w: ['therefore', 'moreover', 'namely'] },
    { q: 'Choose the best linker: "He is friendly; ___, he can be impatient."', c: 'although', w: ['therefore', 'instead of', 'moreover not'] },
  ];

  templates.B1 = [
    (i) => {
      const item = conditionalSet[i % conditionalSet.length];
      return createQuestion('B1', item.q, item.c, item.w);
    },
    (i) => {
      const item = passiveSet[i % passiveSet.length];
      return createQuestion('B1', item.q, item.c, item.w);
    },
    (i) => {
      const item = reportedSpeechSet[i % reportedSpeechSet.length];
      return createQuestion('B1', item.q, item.c, item.w);
    },
    (i) => {
      const item = gerundInfSet[i % gerundInfSet.length];
      return createQuestion('B1', item.q, item.c, item.w);
    },
    (i) => {
      const item = relativeSet[i % relativeSet.length];
      return createQuestion('B1', item.q, item.c, item.w);
    },
    (i) => {
      const item = discourseSetB1[i % discourseSetB1.length];
      return createQuestion('B1', item.q, item.c, item.w);
    },
  ];

  const inversionSet = [
    { q: 'Choose the correct inversion: "Never ___ such a dramatic performance."', c: 'have I seen', w: ['I have seen', 'I seen have', 'did I have seen'] },
    { q: 'Choose the correct inversion: "Rarely ___ on time in winter."', c: 'does the train arrive', w: ['the train arrives', 'arrives the train', 'the train does arrive rarely'] },
    { q: 'Choose the correct inversion: "Not only ___ the budget, but we also improved quality."', c: 'did we reduce', w: ['we reduced', 'we did reduce only', 'did reduce we'] },
    { q: 'Choose the correct inversion: "Seldom ___ such dedication in young teams."', c: 'do you find', w: ['you find', 'find you do', 'you do find seldom'] },
    { q: 'Choose the correct inversion: "Hardly ___ the meeting started."', c: 'had I arrived when', w: ['I had arrived when', 'did I arrive when', 'I arrived hardly when'] },
    { q: 'Choose the correct inversion: "Only then ___ the scale of the issue."', c: 'did we realize', w: ['we realized', 'realized we did', 'we did realize only then'] },
    { q: 'Choose the correct inversion: "Under no circumstances ___ confidential data."', c: 'should employees share', w: ['employees should share', 'should share employees', 'employees share should'] },
    { q: 'Choose the correct inversion: "Little ___ that the plan would fail."', c: 'did they suspect', w: ['they suspected', 'they did suspect little', 'suspected they did'] },
    { q: 'Choose the correct inversion: "Only after the audit ___ the error."', c: 'was the cause identified', w: ['the cause was identified', 'identified was the cause', 'did identify the cause'] },
    { q: 'Choose the correct inversion: "No sooner ___ than the lights went out."', c: 'had we sat down', w: ['we had sat down', 'did we sit down', 'we sat down had'] },
  ];

  const collocationSetB2 = [
    { q: 'Choose the best collocation: "The company plans to ___ market share in Asia."', c: 'gain', w: ['win', 'capture up', 'collect'] },
    { q: 'Choose the best collocation: "We need to ___ a compromise before Friday."', c: 'reach', w: ['arrive', 'touch', 'hit on to'] },
    { q: 'Choose the best collocation: "They launched a campaign to ___ awareness."', c: 'raise', w: ['lift up', 'increase up', 'build to'] },
    { q: 'Choose the best collocation: "Please ___ attention to the final paragraph."', c: 'pay', w: ['give', 'do', 'make'] },
    { q: 'Choose the best collocation: "The board will ___ a decision tomorrow."', c: 'make', w: ['do', 'take up', 'give'] },
    { q: 'Choose the best collocation: "Our department must ___ strict deadlines."', c: 'meet', w: ['hit', 'reach to', 'match on'] },
    { q: 'Choose the best collocation: "The article ___ a crucial point."', c: 'highlights', w: ['brightens', 'explains over', 'spots to'] },
    { q: 'Choose the best collocation: "We should ___ the risks before investing."', c: 'assess', w: ['measure out', 'estimate to', 'observe up'] },
    { q: 'Choose the best collocation: "The proposal failed to ___ support."', c: 'gain', w: ['take', 'collect up', 'reach to'] },
    { q: 'Choose the best collocation: "The team needs to ___ expectations."', c: 'manage', w: ['control to', 'handle up', 'create'] },
  ];

  const vocabSetB2 = [
    { q: 'Choose the closest meaning of "ubiquitous".', c: 'present everywhere', w: ['rarely visible', 'highly expensive', 'poorly designed'] },
    { q: 'Choose the closest meaning of "viable".', c: 'capable of working successfully', w: ['morally doubtful', 'financially ruined', 'legally prohibited'] },
    { q: 'Choose the closest meaning of "deter".', c: 'discourage', w: ['encourage', 'delay briefly', 'describe'] },
    { q: 'Choose the closest meaning of "allocate".', c: 'distribute for a purpose', w: ['copy exactly', 'eliminate', 'argue against'] },
    { q: 'Choose the closest meaning of "scarce".', c: 'in short supply', w: ['extremely valuable', 'easily replaceable', 'widely available'] },
    { q: 'Choose the closest meaning of "coherent".', c: 'logically connected', w: ['emotionally intense', 'vaguely expressed', 'socially awkward'] },
    { q: 'Choose the closest meaning of "to mitigate".', c: 'to make less severe', w: ['to postpone indefinitely', 'to ignore completely', 'to celebrate'] },
    { q: 'Choose the closest meaning of "explicit".', c: 'stated clearly', w: ['partially hidden', 'emotionally charged', 'historically uncertain'] },
    { q: 'Choose the closest meaning of "resilient".', c: 'able to recover quickly', w: ['easily offended', 'strictly controlled', 'financially unstable'] },
    { q: 'Choose the closest meaning of "feasible".', c: 'practical and possible', w: ['ethically questionable', 'severely delayed', 'randomly selected'] },
  ];

  const errorSetB2 = [
    { q: 'Identify the correct sentence.', c: 'Between you and me, this approach is risky.', w: ['Between you and I, this approach is risky.', 'Between I and you, this approach is risky.', 'Between you and myself, this approach risky.'] },
    { q: 'Identify the correct sentence.', c: 'Neither the manager nor the interns were informed.', w: ['Neither the manager nor the interns was informed.', 'Neither the manager or the interns were informed.', 'Neither manager nor interns was informed.'] },
    { q: 'Identify the correct sentence.', c: 'The number of applicants has increased significantly.', w: ['The number of applicants have increased significantly.', 'A number of applicants has increased significantly.', 'The number applicants has increased significantly.'] },
    { q: 'Identify the correct sentence.', c: 'If I were in your position, I would negotiate.', w: ['If I was in your position, I would negotiate.', 'If I am in your position, I would negotiate.', 'If I were in your position, I will negotiate.'] },
    { q: 'Identify the correct sentence.', c: 'She is one of the few engineers who understand this system.', w: ['She is one of the few engineers who understands this system.', 'She is one of the few engineer who understand this system.', 'She is one of few engineers who understands this system.'] },
    { q: 'Identify the correct sentence.', c: 'By the time we arrived, the keynote had already started.', w: ['By the time we arrived, the keynote already started.', 'By the time we arrived, the keynote has already started.', 'By the time we arrived, the keynote had already start.'] },
    { q: 'Identify the correct sentence.', c: 'The committee has reached a unanimous decision.', w: ['The committee have reached a unanimous decision.', 'The committee has reach a unanimous decision.', 'The committee reached a unanimous decision has.'] },
    { q: 'Identify the correct sentence.', c: 'I would rather you stayed until the end.', w: ['I would rather you stay until the end.', 'I would rather you stayed until the ends.', 'I rather you stayed until the end.'] },
    { q: 'Identify the correct sentence.', c: 'Each of the candidates was interviewed separately.', w: ['Each of the candidates were interviewed separately.', 'Each of candidates was interviewed separately.', 'Each candidates was interviewed separately.'] },
    { q: 'Identify the correct sentence.', c: 'Not only did she explain the issue, but she also solved it.', w: ['Not only she explained the issue, but she also solved it.', 'Not only did she explained the issue, but she also solved it.', 'Not only did she explain issue, but she solved also it.'] },
  ];

  const registerSetB2 = [
    { q: 'Choose the most formal sentence for an email.', c: 'I am writing to request further clarification regarding your proposal.', w: ['Can you explain your proposal a bit more?', 'Hey, I need more info about that proposal.', 'Tell me what you mean in your plan.'] },
    { q: 'Choose the most formal sentence for an email.', c: 'Please find attached the revised draft for your review.', w: ['I attached the new file, check it.', 'Here is the file, have a look when free.', 'See attached, let me know quickly.'] },
    { q: 'Choose the most formal sentence for an email.', c: 'We would appreciate receiving your feedback by Friday.', w: ['Send me your comments by Friday.', 'Please reply fast, ideally by Friday.', 'I need your thoughts by Friday.'] },
    { q: 'Choose the most formal sentence for an email.', c: 'Should you require any additional information, please let me know.', w: ['If you need more stuff, tell me.', 'Need anything else? Ping me.', 'Let me know if you want more details, okay?'] },
    { q: 'Choose the most formal sentence for an email.', c: 'I regret to inform you that the meeting has been postponed.', w: ['The meeting is moved, sorry.', 'We changed the meeting time.', 'The meeting got pushed back.'] },
    { q: 'Choose the most formal sentence for an email.', c: 'Your prompt response would be greatly appreciated.', w: ['Please answer soon.', 'Reply quickly, please.', 'Get back to me asap.'] },
    { q: 'Choose the most formal sentence for an email.', c: 'We have taken your concerns into careful consideration.', w: ['We thought about your concerns.', 'We considered what you said.', 'We looked at your points.'] },
    { q: 'Choose the most formal sentence for an email.', c: 'I would be grateful if we could reschedule our appointment.', w: ['Can we move the meeting?', 'Let\'s change the appointment time.', 'Could we pick another slot?'] },
    { q: 'Choose the most formal sentence for an email.', c: 'Please accept my sincere apologies for the inconvenience caused.', w: ['Sorry for the trouble.', 'My bad for the inconvenience.', 'Apologies for the issue.'] },
    { q: 'Choose the most formal sentence for an email.', c: 'I look forward to your confirmation at your earliest convenience.', w: ['Let me know when you can.', 'Please confirm soon.', 'Waiting for your yes.'] },
  ];

  const wordFormSetB2 = [
    { q: 'Choose the correct word form: "The new policy improved operational ___."', c: 'efficiency', w: ['efficient', 'efficiently', 'efficience'] },
    { q: 'Choose the correct word form: "Her explanation was clear and highly ___."', c: 'persuasive', w: ['persuasion', 'persuasively', 'persuade'] },
    { q: 'Choose the correct word form: "They expressed strong ___ about data privacy."', c: 'concerns', w: ['concerned', 'concerningly', 'concernness'] },
    { q: 'Choose the correct word form: "The team acted with complete ___."', c: 'professionalism', w: ['professional', 'professionally', 'profession'] },
    { q: 'Choose the correct word form: "His argument lacked ___ support."', c: 'evidential', w: ['evidence', 'evidently', 'evidentness'] },
    { q: 'Choose the correct word form: "The report highlights the ___ of early planning."', c: 'importance', w: ['important', 'importantly', 'importancy'] },
    { q: 'Choose the correct word form: "The board requested greater financial ___."', c: 'transparency', w: ['transparent', 'transparently', 'transparence'] },
    { q: 'Choose the correct word form: "The update caused significant user ___."', c: 'frustration', w: ['frustrate', 'frustrated', 'frustratingly'] },
    { q: 'Choose the correct word form: "This solution offers long-term ___."', c: 'stability', w: ['stable', 'stably', 'stabilize'] },
    { q: 'Choose the correct word form: "We need greater ___ across departments."', c: 'coordination', w: ['coordinate', 'coordinated', 'coordinately'] },
  ];

  templates.B2 = [
    (i) => createQuestion('B2', inversionSet[i % inversionSet.length].q, inversionSet[i % inversionSet.length].c, inversionSet[i % inversionSet.length].w),
    (i) => createQuestion('B2', collocationSetB2[i % collocationSetB2.length].q, collocationSetB2[i % collocationSetB2.length].c, collocationSetB2[i % collocationSetB2.length].w),
    (i) => createQuestion('B2', vocabSetB2[i % vocabSetB2.length].q, vocabSetB2[i % vocabSetB2.length].c, vocabSetB2[i % vocabSetB2.length].w),
    (i) => createQuestion('B2', errorSetB2[i % errorSetB2.length].q, errorSetB2[i % errorSetB2.length].c, errorSetB2[i % errorSetB2.length].w),
    (i) => createQuestion('B2', registerSetB2[i % registerSetB2.length].q, registerSetB2[i % registerSetB2.length].c, registerSetB2[i % registerSetB2.length].w),
    (i) => createQuestion('B2', wordFormSetB2[i % wordFormSetB2.length].q, wordFormSetB2[i % wordFormSetB2.length].c, wordFormSetB2[i % wordFormSetB2.length].w),
  ];

  const subjunctiveSet = [
    { q: 'Choose the correct subjunctive form: "It is essential that every applicant ___ the form."', c: 'submit', w: ['submits', 'submitted', 'to submit'] },
    { q: 'Choose the correct subjunctive form: "The board recommends that she ___ immediately."', c: 'resign', w: ['resigns', 'resigned', 'to resign'] },
    { q: 'Choose the correct subjunctive form: "It is vital that he ___ present at the hearing."', c: 'be', w: ['is', 'was', 'being'] },
    { q: 'Choose the correct subjunctive form: "They insisted that the report ___ by Friday."', c: 'be delivered', w: ['is delivered', 'was delivered', 'delivered'] },
    { q: 'Choose the correct subjunctive form: "I suggest that she ___ a backup plan."', c: 'prepare', w: ['prepares', 'prepared', 'to prepare'] },
    { q: 'Choose the correct subjunctive form: "The doctor advises that he ___ less sugar."', c: 'consume', w: ['consumes', 'consumed', 'consuming'] },
    { q: 'Choose the correct subjunctive form: "It is imperative that all staff ___ the protocol."', c: 'follow', w: ['follows', 'followed', 'to follow'] },
    { q: 'Choose the correct subjunctive form: "They requested that she ___ the keynote."', c: 'deliver', w: ['delivers', 'delivered', 'delivering'] },
    { q: 'Choose the correct subjunctive form: "The policy requires that data ___ encrypted."', c: 'be', w: ['is', 'was', 'to be'] },
    { q: 'Choose the correct subjunctive form: "We propose that the trial ___ next month."', c: 'begin', w: ['begins', 'began', 'to begin'] },
  ];

  const cleftSet = [
    { q: 'Choose the sentence with correct cleft emphasis.', c: 'It was the budget cuts that delayed the project.', w: ['It was delayed the project by budget cuts.', 'It delayed the project was budget cuts.', 'The budget cuts it was delayed the project.'] },
    { q: 'Choose the sentence with correct cleft emphasis.', c: 'What we need now is a realistic timeline.', w: ['What we need now are realistic timeline.', 'We need now what is a realistic timeline.', 'A realistic timeline what we need now.'] },
    { q: 'Choose the sentence with correct cleft emphasis.', c: 'It is transparency that builds trust in leadership.', w: ['It transparency is that builds trust in leadership.', 'Transparency it is builds trust in leadership.', 'It is builds transparency trust in leadership.'] },
    { q: 'Choose the sentence with correct cleft emphasis.', c: 'What surprised me most was her calm response.', w: ['What surprised me most were her calm response.', 'Surprised me most was what her calm response.', 'Her calm response what surprised me most was.'] },
    { q: 'Choose the sentence with correct cleft emphasis.', c: 'It was during the audit that the discrepancy appeared.', w: ['It during the audit was that appeared discrepancy.', 'During the audit was it discrepancy appeared.', 'It was the discrepancy during audit that appeared.'] },
    { q: 'Choose the sentence with correct cleft emphasis.', c: 'What the team lacks is consistent feedback.', w: ['What the team lacks are consistent feedback.', 'The team lacks what is consistent feedback.', 'Consistent feedback what the team lacks is.'] },
    { q: 'Choose the sentence with correct cleft emphasis.', c: 'It was her persistence that secured the partnership.', w: ['It her persistence was secured the partnership.', 'Her persistence it was that secured partnership.', 'It was secured the partnership by persistence.'] },
    { q: 'Choose the sentence with correct cleft emphasis.', c: 'What concerns investors is long-term volatility.', w: ['What concerns investors are long-term volatility.', 'Investors concerns what is long-term volatility.', 'Long-term volatility what concerns investors is.'] },
    { q: 'Choose the sentence with correct cleft emphasis.', c: 'It is clear communication that prevents confusion.', w: ['It clear communication is prevents confusion.', 'Clear communication it prevents confusion that is.', 'It is prevents confusion clear communication that.'] },
    { q: 'Choose the sentence with correct cleft emphasis.', c: 'What we should prioritize is customer retention.', w: ['What we should prioritize are customer retention.', 'Customer retention what we should prioritize is.', 'We should prioritize what is customer retention.'] },
  ];

  const parallelSet = [
    { q: 'Choose the sentence with correct parallel structure.', c: 'The role requires analyzing data, presenting insights, and coordinating teams.', w: ['The role requires analyzing data, to present insights, and coordinating teams.', 'The role requires analyze data, presenting insights, and to coordinate teams.', 'The role requires analyzing data, presenting insights, and coordination teams.'] },
    { q: 'Choose the sentence with correct parallel structure.', c: 'She is valued for her clarity, her empathy, and her consistency.', w: ['She is valued for her clarity, empathy, and she is consistent.', 'She is valued for clarity, empathic, and consistency.', 'She is valued for being clear, empathy, and consistency.'] },
    { q: 'Choose the sentence with correct parallel structure.', c: 'The strategy aims to reduce costs, improve quality, and accelerate delivery.', w: ['The strategy aims to reduce costs, improving quality, and accelerate delivery.', 'The strategy aims reducing costs, improve quality, and accelerating delivery.', 'The strategy aims to reduce costs, improve quality, and delivery faster.'] },
    { q: 'Choose the sentence with correct parallel structure.', c: 'He can mentor juniors, resolve conflicts, and lead presentations.', w: ['He can mentor juniors, resolving conflicts, and lead presentations.', 'He can mentoring juniors, resolve conflicts, and leading presentations.', 'He can mentor juniors, resolve conflicts, and leadership presentations.'] },
    { q: 'Choose the sentence with correct parallel structure.', c: 'The proposal is ambitious, realistic, and cost-effective.', w: ['The proposal is ambitious, realism, and cost-effective.', 'The proposal is ambitiously, realistic, and cost-effective.', 'The proposal is ambitious, realistic, and costing effectively.'] },
    { q: 'Choose the sentence with correct parallel structure.', c: 'We need to collect evidence, compare alternatives, and document assumptions.', w: ['We need collecting evidence, compare alternatives, and document assumptions.', 'We need to collect evidence, comparing alternatives, and to document assumptions.', 'We need to collect evidence, compare alternatives, and documentation assumptions.'] },
    { q: 'Choose the sentence with correct parallel structure.', c: 'Her goals are to stabilize operations, to rebuild trust, and to increase retention.', w: ['Her goals are stabilizing operations, to rebuild trust, and increase retention.', 'Her goals are to stabilize operations, rebuilding trust, and to increase retention.', 'Her goals are to stabilize operations, to rebuild trust, and increased retention.'] },
    { q: 'Choose the sentence with correct parallel structure.', c: 'The workshop focuses on planning, prioritizing, and communicating effectively.', w: ['The workshop focuses on planning, to prioritize, and communicating effectively.', 'The workshop focuses on plan, prioritizing, and communication effectively.', 'The workshop focuses on planning, prioritizing, and effective communicationly.'] },
    { q: 'Choose the sentence with correct parallel structure.', c: 'They reviewed the budget, revised the scope, and approved the timeline.', w: ['They reviewed the budget, revising the scope, and approved the timeline.', 'They reviewed budget, revised the scope, and approving the timeline.', 'They reviewed the budget, revised the scope, and approval the timeline.'] },
    { q: 'Choose the sentence with correct parallel structure.', c: 'A good leader listens actively, responds thoughtfully, and acts decisively.', w: ['A good leader listens actively, responding thoughtfully, and acts decisively.', 'A good leader to listen actively, responds thoughtfully, and acts decisively.', 'A good leader listens active, responds thoughtfully, and acts decisively.'] },
  ];

  const modalPerfectSet = [
    { q: 'Choose the best option: "She ___ the email; she replied within a minute."', c: 'must have seen', w: ['should have seen', 'might have seeing', 'must saw'] },
    { q: 'Choose the best option: "They ___ the address, because they arrived at the wrong building."', c: 'might have misunderstood', w: ['must have understanding', 'should misunderstood', 'must misunderstood'] },
    { q: 'Choose the best option: "He ___ the meeting; his calendar was blocked."', c: 'can\'t have forgotten', w: ['must have forgot', 'can\'t forgot', 'might have forget'] },
    { q: 'Choose the best option: "The package ___ by now, given the tracking status."', c: 'should have arrived', w: ['must arrived', 'should arrived', 'might arriving'] },
    { q: 'Choose the best option: "She ___ that result without months of preparation."', c: 'couldn\'t have achieved', w: ['couldn\'t achieved', 'mustn\'t have achieved', 'couldn\'t achieving'] },
    { q: 'Choose the best option: "They ___ the warning; otherwise they would have acted sooner."', c: 'may not have noticed', w: ['must not noticed', 'may not noticed', 'may not have notice'] },
    { q: 'Choose the best option: "He ___ the deadline, but we cannot be certain."', c: 'might have missed', w: ['must have miss', 'might missed', 'can\'t have missed'] },
    { q: 'Choose the best option: "Given the evidence, the issue ___ earlier."', c: 'must have started', w: ['must started', 'might start', 'must have start'] },
    { q: 'Choose the best option: "She ___ upset, yet she remained calm."', c: 'might have been', w: ['might been', 'must have being', 'could have be'] },
    { q: 'Choose the best option: "The team ___ exhausted after working overnight."', c: 'must have been', w: ['must been', 'might be been', 'must have be'] },
  ];

  const academicVocabSet = [
    { q: 'Choose the best academic verb: "The findings ___ a significant correlation."', c: 'indicate', w: ['tell', 'say', 'show up'] },
    { q: 'Choose the best academic verb: "The study aims to ___ the impact of remote work."', c: 'examine', w: ['look', 'check out', 'find out quickly'] },
    { q: 'Choose the best academic verb: "The report ___ three key limitations."', c: 'outlines', w: ['draws', 'shows off', 'mentions up'] },
    { q: 'Choose the best academic verb: "The data ___ the initial hypothesis."', c: 'supports', w: ['backs up quickly', 'says', 'goes with'] },
    { q: 'Choose the best academic verb: "Researchers ___ a longitudinal approach."', c: 'adopted', w: ['picked up', 'went with', 'used on'] },
    { q: 'Choose the best academic verb: "The paper ___ a framework for analysis."', c: 'proposes', w: ['gives out', 'brings', 'sets up on'] },
    { q: 'Choose the best academic verb: "The author ___ that policy reform is overdue."', c: 'argues', w: ['talks', 'says to', 'goes over'] },
    { q: 'Choose the best academic verb: "This section ___ previous literature."', c: 'reviews', w: ['looks', 'checks out', 'turns over'] },
    { q: 'Choose the best academic verb: "The appendix ___ the survey instrument."', c: 'includes', w: ['contains in', 'has got', 'holds up'] },
    { q: 'Choose the best academic verb: "The model ___ potential outcomes under uncertainty."', c: 'predicts', w: ['guesses at', 'tells', 'thinks of'] },
  ];

  const coherenceSetC1 = [
    { q: 'Choose the best connector: "The policy is costly; ___, it may be necessary."', c: 'nonetheless', w: ['for example', 'therefore because', 'in contrast to this reason'] },
    { q: 'Choose the best connector: "___ the evidence is limited, the trend is consistent."', c: 'Although', w: ['Because', 'Therefore', 'In order to'] },
    { q: 'Choose the best connector: "The pilot failed; ___, valuable insights were gained."', c: 'nevertheless', w: ['in addition to', 'as a result of this', 'for instance'] },
    { q: 'Choose the best connector: "The data are incomplete; ___, no final claim can be made."', c: 'therefore', w: ['however', 'meanwhile', 'for example'] },
    { q: 'Choose the best connector: "___ being expensive, the solution is scalable."', c: 'Despite', w: ['Because', 'Therefore', 'Due to'] },
    { q: 'Choose the best connector: "The results were mixed; ___, the intervention was retained."', c: 'even so', w: ['for example', 'because of this', 'instead of'] },
    { q: 'Choose the best connector: "The argument is plausible; ___, it lacks empirical support."', c: 'however', w: ['consequently', 'furthermore because', 'moreover then'] },
    { q: 'Choose the best connector: "The market stabilized; ___, investor confidence returned."', c: 'as a result', w: ['nevertheless', 'for instance', 'while'] },
    { q: 'Choose the best connector: "___ the timeline is tight, we can still meet it."', c: 'Even though', w: ['Because', 'Therefore', 'As soon as'] },
    { q: 'Choose the best connector: "The conclusion is tentative; ___, it is methodologically sound."', c: 'nonetheless', w: ['for this reason why', 'in that case', 'in comparison of'] },
  ];

  templates.C1 = [
    (i) => createQuestion('C1', subjunctiveSet[i % subjunctiveSet.length].q, subjunctiveSet[i % subjunctiveSet.length].c, subjunctiveSet[i % subjunctiveSet.length].w),
    (i) => createQuestion('C1', cleftSet[i % cleftSet.length].q, cleftSet[i % cleftSet.length].c, cleftSet[i % cleftSet.length].w),
    (i) => createQuestion('C1', parallelSet[i % parallelSet.length].q, parallelSet[i % parallelSet.length].c, parallelSet[i % parallelSet.length].w),
    (i) => createQuestion('C1', modalPerfectSet[i % modalPerfectSet.length].q, modalPerfectSet[i % modalPerfectSet.length].c, modalPerfectSet[i % modalPerfectSet.length].w),
    (i) => createQuestion('C1', academicVocabSet[i % academicVocabSet.length].q, academicVocabSet[i % academicVocabSet.length].c, academicVocabSet[i % academicVocabSet.length].w),
    (i) => createQuestion('C1', coherenceSetC1[i % coherenceSetC1.length].q, coherenceSetC1[i % coherenceSetC1.length].c, coherenceSetC1[i % coherenceSetC1.length].w),
  ];

  const thirdConditionalSet = [
    { q: 'Complete the sentence: "Had I known about the strike, I ___ earlier."', c: 'would have left', w: ['would leave', 'had left', 'left'] },
    { q: 'Complete the sentence: "If they had reviewed the contract, they ___ the clause."', c: 'would have noticed', w: ['would notice', 'noticed', 'would had noticed'] },
    { q: 'Complete the sentence: "Had she prepared properly, she ___ the interview."', c: 'would have aced', w: ['would ace', 'would have aces', 'had aced'] },
    { q: 'Complete the sentence: "If we had invested earlier, we ___ substantial returns."', c: 'might have seen', w: ['might see', 'might had seen', 'saw'] },
    { q: 'Complete the sentence: "Had he not ignored the warning, the incident ___."', c: 'could have been avoided', w: ['could be avoided', 'could avoided', 'was avoided'] },
    { q: 'Complete the sentence: "If I had not missed the train, I ___ on time."', c: 'would have arrived', w: ['would arrive', 'arrived', 'would had arrived'] },
    { q: 'Complete the sentence: "Had they communicated sooner, the conflict ___."', c: 'might have de-escalated', w: ['might de-escalate', 'de-escalated', 'might had de-escalated'] },
    { q: 'Complete the sentence: "If she had asked for help, she ___ so overwhelmed."', c: 'wouldn\'t have felt', w: ['wouldn\'t feel', 'didn\'t feel', 'wouldn\'t had felt'] },
    { q: 'Complete the sentence: "Had we tested the update, we ___ the outage."', c: 'could have prevented', w: ['could prevent', 'prevented', 'could had prevented'] },
    { q: 'Complete the sentence: "If he had negotiated better, he ___ the role."', c: 'might have accepted', w: ['might accept', 'accepted', 'might had accepted'] },
  ];

  const nuanceVocabSetC2 = [
    { q: 'Choose the best meaning of "ephemeral".', c: 'lasting for a very short time', w: ['permanent and stable', 'intensely emotional', 'difficult to justify'] },
    { q: 'Choose the best meaning of "equivocal".', c: 'open to more than one interpretation', w: ['fully transparent', 'strongly emotional', 'legally binding'] },
    { q: 'Choose the best meaning of "intransigent".', c: 'unwilling to compromise', w: ['eager to collaborate', 'financially unstable', 'socially awkward'] },
    { q: 'Choose the best meaning of "parsimonious".', c: 'extremely unwilling to spend money', w: ['remarkably generous', 'efficiently organized', 'easy to understand'] },
    { q: 'Choose the best meaning of "ostensibly".', c: 'apparently, but perhaps not actually', w: ['in complete secrecy', 'with full certainty', 'for legal reasons only'] },
    { q: 'Choose the best meaning of "quintessential".', c: 'representing the most perfect example', w: ['hardly noticeable', 'historically inaccurate', 'overly complicated'] },
    { q: 'Choose the best meaning of "obfuscate".', c: 'to make something difficult to understand', w: ['to clarify completely', 'to summarize briefly', 'to negotiate effectively'] },
    { q: 'Choose the best meaning of "ameliorate".', c: 'to make a situation better', w: ['to intensify conflict', 'to avoid responsibility', 'to create confusion'] },
    { q: 'Choose the best meaning of "tenuous".', c: 'weak or not strongly supported', w: ['firmly established', 'emotionally moving', 'strictly confidential'] },
    { q: 'Choose the best meaning of "zeitgeist".', c: 'the defining spirit of a particular time', w: ['a philosophical doctrine', 'a historical archive', 'an economic downturn'] },
  ];

  const errorSetC2 = [
    { q: 'Choose the grammatically correct sentence.', c: 'Were it not for her guidance, the initiative would have collapsed.', w: ['Was it not for her guidance, the initiative would have collapsed.', 'If not were for her guidance, the initiative would have collapsed.', 'Were it not for her guidance, the initiative had collapsed.'] },
    { q: 'Choose the grammatically correct sentence.', c: 'Scarcely had the vote concluded when objections were raised.', w: ['Scarcely the vote had concluded when objections were raised.', 'Scarcely had the vote conclude when objections were raised.', 'Scarcely had concluded the vote when objections were raised.'] },
    { q: 'Choose the grammatically correct sentence.', c: 'No sooner had the merger been announced than the stock price surged.', w: ['No sooner the merger had been announced than the stock price surged.', 'No sooner had the merger announced than the stock price surged.', 'No sooner had been announced the merger than the stock price surged.'] },
    { q: 'Choose the grammatically correct sentence.', c: 'So compelling was the evidence that the jury reached a verdict swiftly.', w: ['So compelling the evidence was that the jury reached a verdict swiftly.', 'So was compelling the evidence that the jury reached a verdict swiftly.', 'So compelling was evidence that jury reached a verdict swiftly.'] },
    { q: 'Choose the grammatically correct sentence.', c: 'Not until the final review did the discrepancy become apparent.', w: ['Not until the final review the discrepancy did become apparent.', 'Not until did the final review the discrepancy become apparent.', 'Not until the final review did became the discrepancy apparent.'] },
    { q: 'Choose the grammatically correct sentence.', c: 'Had the assumptions been tested rigorously, the model would have proven robust.', w: ['Had the assumptions tested rigorously, the model would have proven robust.', 'If had the assumptions been tested rigorously, the model would have proven robust.', 'Had been tested rigorously the assumptions, the model would have proven robust.'] },
    { q: 'Choose the grammatically correct sentence.', c: 'Little did they realize how far-reaching the consequences would be.', w: ['Little they did realize how far-reaching the consequences would be.', 'Little did they realized how far-reaching the consequences would be.', 'Little did realize they how far-reaching the consequences would be.'] },
    { q: 'Choose the grammatically correct sentence.', c: 'Only once the data had been triangulated could the claim be substantiated.', w: ['Only once the data had been triangulated the claim could be substantiated.', 'Only once had the data been triangulated could the claim substantiated.', 'Only once the data triangulated had could the claim be substantiated.'] },
    { q: 'Choose the grammatically correct sentence.', c: 'Were the proposal to pass, substantial regulatory revisions would follow.', w: ['Was the proposal to pass, substantial regulatory revisions would follow.', 'Were the proposal pass, substantial regulatory revisions would follow.', 'Were to pass the proposal, substantial regulatory revisions would follow.'] },
    { q: 'Choose the grammatically correct sentence.', c: 'Such was the scale of disruption that contingency plans proved insufficient.', w: ['Such the scale of disruption was that contingency plans proved insufficient.', 'Such was scale of disruption that contingency plans proved insufficient.', 'Such was the scale disruption that contingency plans proved insufficient.'] },
  ];

  const idiomSetC2 = [
    { q: 'Choose the best meaning of "to walk a tightrope" in negotiations.', c: 'to balance carefully between conflicting pressures', w: ['to postpone decisions indefinitely', 'to make reckless promises', 'to refuse all compromise'] },
    { q: 'Choose the best meaning of "to move the goalposts".', c: 'to change criteria unfairly during a process', w: ['to set clearer objectives', 'to accelerate delivery', 'to simplify communication'] },
    { q: 'Choose the best meaning of "to throw someone under the bus".', c: 'to sacrifice someone for personal advantage', w: ['to support someone publicly', 'to assign someone a new role', 'to train someone intensively'] },
    { q: 'Choose the best meaning of "a poisoned chalice".', c: 'a role that seems attractive but is likely to cause problems', w: ['a generous long-term offer', 'a harmless symbolic position', 'a successful investment strategy'] },
    { q: 'Choose the best meaning of "to call someone\'s bluff".', c: 'to challenge a threat believed to be empty', w: ['to apologize sincerely', 'to negotiate lower costs', 'to avoid confrontation'] },
    { q: 'Choose the best meaning of "to read the room".', c: 'to understand the unspoken mood and dynamics', w: ['to evaluate architecture', 'to memorize meeting notes', 'to summarize statistics'] },
    { q: 'Choose the best meaning of "to have skin in the game".', c: 'to have personal risk or investment in an outcome', w: ['to hold legal authority', 'to remain neutral', 'to avoid responsibility'] },
    { q: 'Choose the best meaning of "to thread the needle".', c: 'to achieve a difficult balance between competing demands', w: ['to complete a trivial task', 'to reject all alternatives', 'to copy a previous solution'] },
    { q: 'Choose the best meaning of "to open a can of worms".', c: 'to create many unexpected complications', w: ['to solve a long-standing issue', 'to simplify procedures', 'to launch a communication campaign'] },
    { q: 'Choose the best meaning of "to be on thin ice".', c: 'to be in a risky or vulnerable position', w: ['to be physically cold', 'to be highly confident', 'to hold decisive leverage'] },
  ];

  const styleSetC2 = [
    { q: 'Choose the most precise completion: "The committee\'s response was not merely delayed; it was ___ evasive."', c: 'deliberately', w: ['pleasantly', 'casually', 'hastily'] },
    { q: 'Choose the most precise completion: "Her critique was incisive yet ___, avoiding unnecessary hostility."', c: 'measured', w: ['random', 'boisterous', 'tentative and loud'] },
    { q: 'Choose the most precise completion: "The witness provided a ___ account, leaving little room for doubt."', c: 'meticulous', w: ['careless', 'fragmentary', 'ambiguous and vague'] },
    { q: 'Choose the most precise completion: "His argument appeared coherent, but the evidence was ___ insufficient."', c: 'demonstrably', w: ['pleasantly', 'accidentally', 'emotionally'] },
    { q: 'Choose the most precise completion: "The reform was praised as bold, though its implementation remained ___."', c: 'patchy', w: ['flawless', 'uniform', 'inevitable'] },
    { q: 'Choose the most precise completion: "Their apology sounded polished but ultimately ___."', c: 'disingenuous', w: ['heartfelt', 'transparent', 'conciliatory'] },
    { q: 'Choose the most precise completion: "The CEO\'s remarks were carefully worded to remain ___."', c: 'non-committal', w: ['conclusive', 'transparent', 'unscripted'] },
    { q: 'Choose the most precise completion: "The policy achieved short-term gains at a ___ social cost."', c: 'considerable', w: ['negligible', 'imaginary', 'optional'] },
    { q: 'Choose the most precise completion: "The narrative is compelling but methodologically ___."', c: 'fragile', w: ['airtight', 'definitive', 'unassailable'] },
    { q: 'Choose the most precise completion: "The settlement offered closure, albeit a ___ one."', c: 'provisional', w: ['final and complete', 'celebratory', 'trivial'] },
  ];

  const discourseC2 = [
    { q: 'Choose the best completion: "___, the tribunal concluded that no single party bore full responsibility."', c: 'After weighing competing testimonies', w: ['Because everyone shouted', 'As things looked simple', 'By ignoring all evidence'] },
    { q: 'Choose the best completion: "___, the policy may stabilize prices but widen inequality."', c: 'On balance', w: ['Without thinking', 'At random', 'By coincidence only'] },
    { q: 'Choose the best completion: "___, the recommendation remains contingent on fiscal reform."', c: 'All things considered', w: ['In short temper', 'As luck had it', 'By contrast quickly'] },
    { q: 'Choose the best completion: "___, the committee deferred publication pending legal review."', c: 'Given the sensitivity of the findings', w: ['Since lunch was late', 'Because the room was cold', 'As nobody listened'] },
    { q: 'Choose the best completion: "___, the allegations could not be substantiated beyond speculation."', c: 'Absent corroborating evidence', w: ['With louder voices', 'After emotional debate', 'During routine scheduling'] },
    { q: 'Choose the best completion: "___, the regulator introduced stricter disclosure rules."', c: 'In response to repeated compliance failures', w: ['To save printing costs', 'Because markets were calm', 'To shorten meetings'] },
    { q: 'Choose the best completion: "___, the coalition collapsed within months."', c: 'Despite a promising start', w: ['Given immediate success forever', 'Thanks to unanimous enthusiasm', 'Because all conflicts vanished'] },
    { q: 'Choose the best completion: "___, the judgment prioritized constitutional safeguards over expediency."', c: 'In a move that surprised observers', w: ['For no reason at all', 'As expected by nobody everywhere', 'After ignoring all precedents'] },
    { q: 'Choose the best completion: "___, the evidence pointed to systemic negligence rather than isolated error."', c: 'Taken as a whole', w: ['Viewed from one email', 'Seen through rumor', 'Considered without context'] },
    { q: 'Choose the best completion: "___, the court declined to issue an immediate injunction."', c: 'Without demonstrating irreparable harm', w: ['With complete certainty of guilt', 'After approving every claim', 'By simplifying all procedures'] },
  ];

  templates.C2 = [
    (i) => createQuestion('C2', thirdConditionalSet[i % thirdConditionalSet.length].q, thirdConditionalSet[i % thirdConditionalSet.length].c, thirdConditionalSet[i % thirdConditionalSet.length].w),
    (i) => createQuestion('C2', nuanceVocabSetC2[i % nuanceVocabSetC2.length].q, nuanceVocabSetC2[i % nuanceVocabSetC2.length].c, nuanceVocabSetC2[i % nuanceVocabSetC2.length].w),
    (i) => createQuestion('C2', errorSetC2[i % errorSetC2.length].q, errorSetC2[i % errorSetC2.length].c, errorSetC2[i % errorSetC2.length].w),
    (i) => createQuestion('C2', idiomSetC2[i % idiomSetC2.length].q, idiomSetC2[i % idiomSetC2.length].c, idiomSetC2[i % idiomSetC2.length].w),
    (i) => createQuestion('C2', styleSetC2[i % styleSetC2.length].q, styleSetC2[i % styleSetC2.length].c, styleSetC2[i % styleSetC2.length].w),
    (i) => createQuestion('C2', discourseC2[i % discourseC2.length].q, discourseC2[i % discourseC2.length].c, discourseC2[i % discourseC2.length].w),
  ];

  return templates;
}

function toMarkdown(dataByLevel) {
  const parts = [];

  for (const level of LEVEL_ORDER) {
    const questions = dataByLevel[level] || [];
    parts.push(`Уровень ${level}`);
    for (let i = 0; i < questions.length; i += 1) {
      const q = questions[i];
      parts.push(`Вопрос ${i + 1}: ${q.question}`);
      for (let optIndex = 0; optIndex < q.options.length; optIndex += 1) {
        parts.push(`${optIndex + 1}. ${q.options[optIndex]}`);
      }
      parts.push(`Правильный ответ: ${q.correct_option + 1}. ${q.options[q.correct_option]}`);
      parts.push('');
    }
    parts.push('');
  }

  return `${parts.join('\n').trim()}\n`;
}

function validate(allQuestions) {
  if (allQuestions.length !== 500) {
    throw new Error(`Expected 500 questions, got ${allQuestions.length}`);
  }

  const seenQuestionText = new Set();
  for (const q of allQuestions) {
    const questionText = String(q.question_text || '').trim();
    if (!q.level || !LEVEL_ORDER.includes(q.level)) {
      throw new Error(`Invalid level: ${q.level}`);
    }
    if (!questionText || seenQuestionText.has(`${q.level}::${questionText.toLowerCase()}`)) {
      throw new Error(`Duplicate or empty question: ${questionText}`);
    }
    seenQuestionText.add(`${q.level}::${questionText.toLowerCase()}`);

    if (!Array.isArray(q.options) || q.options.length !== 4) {
      throw new Error(`Invalid options count for question: ${questionText}`);
    }

    const optionSet = new Set(q.options.map((o) => o.toLowerCase()));
    if (optionSet.size !== 4) {
      throw new Error(`Duplicate options in question: ${questionText}`);
    }

    if (q.correct_option < 0 || q.correct_option > 3) {
      throw new Error(`Invalid correct option index for question: ${questionText}`);
    }
  }

  const perLevel = allQuestions.reduce((acc, q) => {
    acc[q.level] = (acc[q.level] || 0) + 1;
    return acc;
  }, {});

  for (const [level, target] of Object.entries(LEVEL_TARGETS)) {
    if ((perLevel[level] || 0) !== target) {
      throw new Error(`Invalid distribution for ${level}: expected ${target}, got ${perLevel[level] || 0}`);
    }
  }
}

function main() {
  const templates = buildTemplates();
  const globalUsed = new Set();
  const dataByLevel = {};

  for (const level of LEVEL_ORDER) {
    dataByLevel[level] = buildLevel(level, LEVEL_TARGETS[level], templates[level], globalUsed);
  }

  const allQuestions = [];
  let currentId = 1;
  for (const level of LEVEL_ORDER) {
    for (const q of dataByLevel[level]) {
      allQuestions.push({
        id: currentId,
        level: q.level,
        question_text: q.question,
        options: q.options,
        correct_option: q.correct_option,
        is_active: true,
      });
      currentId += 1;
    }
  }

  validate(allQuestions);

  fs.mkdirSync(path.resolve('supabase/data'), { recursive: true });
  fs.writeFileSync(path.resolve('supabase/data/question_bank.json'), `${JSON.stringify(allQuestions, null, 2)}\n`, 'utf8');

  const markdown = toMarkdown(dataByLevel);
  fs.writeFileSync(path.resolve('supabase/data/question_bank.md'), markdown, 'utf8');

  const externalPath = process.env.QUESTION_BANK_MD_PATH;
  if (externalPath) {
    fs.mkdirSync(path.dirname(externalPath), { recursive: true });
    fs.writeFileSync(externalPath, markdown, 'utf8');
  }

  const summary = LEVEL_ORDER.map((level) => `${level}: ${dataByLevel[level].length}`).join(', ');
  console.log(`Generated ${allQuestions.length} questions (${summary})`);
  console.log(`JSON: ${path.resolve('supabase/data/question_bank.json')}`);
  console.log(`MD: ${path.resolve('supabase/data/question_bank.md')}`);
  if (externalPath) {
    console.log(`MD external: ${externalPath}`);
  }
}

main();
