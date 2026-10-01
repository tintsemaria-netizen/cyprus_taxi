import type { Catalog } from '../../types';
import type en from '../en/common';

const common: Catalog<typeof en> = {
  brandTagline: 'Заказ такси по всему Кипру',
  book: 'Заказать',
  cancel: 'Отмена',
  close: 'Закрыть',
  back: 'Назад',
  retry: 'Повторить',
  loading: 'Загрузка…',
  pleaseWait: 'Подождите…',
  signOut: 'Выйти',
  myTrip: 'Моя поездка',
  language: 'Язык',
  networkError: 'Проблема с сетью — проверьте подключение и попробуйте снова.',
  somethingWrong: 'Что-то пошло не так. Попробуйте ещё раз.',
  emergency112: 'В экстренной ситуации звоните 112.',
  passengers: { one: '{count} пассажир', few: '{count} пассажира', many: '{count} пассажиров', other: '{count} пассажира' },
  minutes: { one: '{count} мин', other: '{count} мин' },
  status: {
    REQUESTED: 'Запланированная поездка',
    SEARCHING: 'Ищем водителя',
    NO_DRIVER: 'Свободных водителей нет',
    ASSIGNED: 'Водитель назначен',
    EN_ROUTE: 'Водитель едет к вам',
    ARRIVED: 'Водитель на месте',
    IN_PROGRESS: 'В пути',
    COMPLETED: 'Поездка завершена',
    CANCELED: 'Заказ отменён',
  },
  vClass: { COMFORT: 'Comfort', XL: 'XL' },
  payment: { CASH_TO_DRIVER: 'Наличными водителю' },
};
export default common;
