/** Настройки компании и прайс по умолчанию. Все цены — в гривнах, вымышленные. */

export type CategoryId = 'sofa' | 'armchair' | 'mattress' | 'chair' | 'other';
export const CATEGORY_IDS: CategoryId[] = ['sofa', 'armchair', 'mattress', 'chair', 'other'];

export interface Variant { id: string; label: string; price: number }
export interface CategoryPrice { label: string; manual?: boolean; variants: Variant[] }

export interface Pricing {
  minOrder: number;            // минимум для суммы чистки, ₴
  heavySoilingPct: number;     // надбавка за сильные загрязнения, %
  mattressSecondSidePct: number; // вторая сторона матраса, % от базовой цены
  outOfTownFee: number;        // фиксированная доплата за выезд за город, ₴
  roundTo: number;             // шаг округления цены строки, ₴
  categories: Record<CategoryId, CategoryPrice>;
}

export interface Company {
  name: string; tagline: string; city: string; territory: string;
  phone: string; telegram: string; email: string; hours: string;
  accent: string;              // HEX акцентного цвета
  legalName: string;           // для политики конфиденциальности
}

export type GameMode = 'off' | 'fun' | 'bonus';
export interface Game { mode: GameMode; bonusAmount: number; bonusValidDays: number; bonusMinOrder: number }

export type CharacterPreset = 'friendly' | 'calm' | 'cheeky';
export interface Characters { preset: CharacterPreset; faces: boolean; phrases: boolean }

export interface Settings { company: Company; pricing: Pricing; game: Game; characters: Characters }

export const DEFAULT_SETTINGS: Settings = {
  company: {
    name: 'Помпон',
    tagline: 'Выездная химчистка мягкой мебели',
    city: 'Киев',
    territory: 'Киев и пригород до 30 км',
    phone: '',
    telegram: '',
    email: '',
    hours: 'Ежедневно 9:00–20:00',
    accent: '#2F7D6D',
    legalName: 'ФЛП «Пример» (замените в настройках)'
  },
  pricing: {
    minOrder: 800,
    heavySoilingPct: 30,
    mattressSecondSidePct: 60,
    outOfTownFee: 300,
    roundTo: 10,
    categories: {
      sofa: { label: 'Диван', variants: [
        { id: 'seat2', label: '2 места', price: 900 },
        { id: 'seat3', label: '3 места', price: 1200 },
        { id: 'corner', label: 'Угловой', price: 1550 }] },
      armchair: { label: 'Кресло', variants: [
        { id: 'regular', label: 'Обычное', price: 500 },
        { id: 'recliner', label: 'Реклайнер', price: 720 }] },
      mattress: { label: 'Матрас', variants: [
        { id: 'single', label: 'Односпальный', price: 700 },
        { id: 'double', label: 'Двуспальный', price: 1000 }] },
      chair: { label: 'Стул', variants: [
        { id: 'seat', label: 'Только сиденье', price: 150 },
        { id: 'seatback', label: 'Сиденье со спинкой', price: 230 }] },
      other: { label: 'Другое', manual: true, variants: [] }
    }
  },
  game: { mode: 'fun', bonusAmount: 150, bonusValidDays: 90, bonusMinOrder: 1000 },
  characters: { preset: 'friendly', faces: true, phrases: true }
};

/** Заранее написанные реплики персонажей. Без нейросети. */
export const PHRASES: Record<CharacterPreset, Record<CategoryId, string[]>> = {
  friendly: {
    sofa: ['Привет! Я тут главный по посиделкам.', 'На мне смотрели сериалы. Много сериалов.', 'Освежите меня — я снова стану любимым местом.'],
    armchair: ['Здравствуйте! Подлокотники — моя слабость.', 'Кресло к вашим услугам.', 'После чистки обниму ещё мягче.'],
    mattress: ['Доброе утро! Я про сон, а не про пыль.', 'Каждую ночь работаю без выходных.', 'Две стороны — двойная свежесть.'],
    chair: ['Привет! Я стою за каждым ужином.', 'Пятно от соуса? Бывает.', 'Нас обычно много — посчитайте всех.'],
    other: ['Пуф, коляска, изголовье? Покажите фото!', 'Не нашли себя в списке? Опишите — оценим.', 'Чистим почти всё мягкое.']
  },
  calm: {
    sofa: ['Диван. Сухо и аккуратно.', 'Чистка за один визит.'],
    armchair: ['Кресло. Без лишних слов.', 'Освежим ткань бережно.'],
    mattress: ['Матрас. Сон станет чище.', 'Можно почистить обе стороны.'],
    chair: ['Стул. Быстро и тщательно.', 'Цена за штуку.'],
    other: ['Опишите предмет и приложите фото.', 'Стоимость — после оценки.']
  },
  cheeky: {
    sofa: ['Эй! Да, вы. Посмотрите на мои подушки.', 'Я видел ваши перекусы. Все.'],
    armchair: ['Я не толстый, я мягкий.', 'Сядьте. Ой, сначала почистите.'],
    mattress: ['Я храню секреты. И немного пыли.', 'Переверни меня — там тоже интересно.'],
    chair: ['Я ножек больше, чем у вас.', 'Табурет? Обижаете.'],
    other: ['Я загадочный предмет. Сфоткайте меня.', 'Цена? По фото, как в лучших домах.']
  }
};

export const STATUSES = ['new', 'agreed', 'done', 'cancelled'] as const;
export type Status = (typeof STATUSES)[number];
export const STATUS_LABEL: Record<Status, string> = { new: 'Новая', agreed: 'Согласована', done: 'Завершена', cancelled: 'Отменена' };

export const LIMITS = { maxLines: 30, maxQty: 20, maxPhotos: 3, maxPhotoBytes: 10 * 1024 * 1024, maxDescription: 500, maxComment: 1000 };
