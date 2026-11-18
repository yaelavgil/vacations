// מאגר מקומות חופשה — הגדרות
// הדאטה יושב ב-Realtime Database של הפרוייקט home-picks-47450 (europe-west1).
// DB_PATH הוא המקום היחיד שצריך לשנות אם מעבירים את הענף.
//
// כרגע: picks/_vacations — ענף שכבר פתוח לקריאה/כתיבה בכללים הקיימים,
// ולכן האפליקציה עובדת בלי לגעת בקונסול של Firebase.
// הקידומת _ גורמת לקוד הקיים של home-decisions לדלג על הענף.
//
// אחרי פרסום הכללים שב-firebase-rules.json בקונסול,
// משנים כאן ל-'vacations' ומריצים את ההעברה (ראי README).

export const DB = 'https://home-picks-47450-default-rtdb.europe-west1.firebasedatabase.app';
export const DB_PATH = 'picks/_vacations';

export const PLACES_URL = (key) =>
  `${DB}/${DB_PATH}/places${key ? '/' + encodeURIComponent(key) : ''}.json`;

/* ---------------- החבורה ----------------
   7 משפחות בסך הכל, כולל שלנו.
   שתיים מהן עם שני ילדים, חמש עם שלושה.
   לא תמיד נוסעים כולם — ולכן כל מקום נבדק מול הרכבים אפשריים. */
export const CREW = {
  families: 7,
  withTwoKids: 2,
  withThreeKids: 5,
  // גילאי הילדים בחבורה, נכון ל-2026
  ageBands: [
    { label: 'הגדולים', from: 12, to: 13 },
    { label: 'האמצע',   from: 8,  to: 10 },
    { label: 'הקטנים',  from: 5,  to: 6 },
  ],
  // נפשות למשפחה: 2 מבוגרים + 2 או 3 ילדים
  peopleFor: (families) => {
    const f = Math.max(0, Math.min(families, 7));
    const three = Math.min(f, 5);        // קודם המשפחות הגדולות
    const two = Math.max(0, f - three);
    return three * 5 + two * 4;
  },
};

/* ---------------- נישות ----------------
   מקום יכול להשתייך ליותר מנישה אחת. */
export const NICHES = [
  { id: 'crew',   label: 'עם החבורה',      short: 'חבורה',  icon: '🏡',
    hint: 'מתחם של 2–6 יחידות, לכל משפחה אזור משלה' },
  { id: 'family', label: 'רק המשפחה שלנו', short: 'רק אנחנו', icon: '👨‍👩‍👧‍👦',
    hint: 'חופשה משפחתית שלנו לבד' },
  { id: 'kids',   label: 'חו״ל עם ילדים',  short: 'חו״ל+ילדים', icon: '✈️',
    hint: 'חופשה בחו״ל עם הילדים' },
  { id: 'adults', label: 'חו״ל בלי ילדים', short: 'חו״ל זוגי', icon: '🥂',
    hint: 'הנישה הכי שווה' },
];

/* ---------------- אזורים ----------------
   משמש לסינון וגם כרשימת החיפוש שלנו. */
export const AREAS_IL = [
  'רמת הגולן', 'גליל עליון', 'גליל תחתון', 'עמק יזרעאל', 'עמק המעיינות',
  'כנרת', 'ים המלח', 'מדבר יהודה', 'נגב', 'ערבה', 'אילת והסביבה',
  'שפלה', 'מרכז', 'חוף הים', 'ירושלים והסביבה',
];

/* ---------------- סוגי מקום ---------------- */
export const LAYOUTS = [
  { id: 'compound', label: 'מתחם צימרים' },
  { id: 'villas',   label: 'וילות צמודות' },
  { id: 'villa',    label: 'וילה אחת גדולה' },
  { id: 'glamping', label: 'גלמפינג' },
  { id: 'hotel',    label: 'מלון קטן' },
  { id: 'bighotel', label: 'מלון גדול' },
  { id: 'apt',      label: 'דירות נופש' },
];

/* ---------------- פרטיות ----------------
   יעל: ״מעדיפים מקומות שהם רק לנו ולא צריך להיות בקשט ולהתחשב באחרים.
   מבודדים לפחות.״ */
export const PRIVACY = [
  { id: 'exclusive', label: 'המתחם כולו שלנו', rank: 3 },
  { id: 'isolated',  label: 'מבודד',            rank: 2 },
  { id: 'shared',    label: 'משותף עם אחרים',   rank: 1 },
];

/* ---------------- החרגות ----------------
   מקומות שלא חוזרים אליהם, ולמה. */
export const EXCLUDED = [
  { name: 'נחשולים',
    why: 'הסגנון כן — המקום עצמו לא. אירוע קשה שקרה שם לחברה טובה.' },
];

export const GROUP_SIZE = CREW.families;
