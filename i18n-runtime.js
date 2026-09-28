/* i18n-runtime.js — runtime tłumaczenie PL → inne języki (teraz: RU).
   Łapie statyczny HTML, tooltipy, placeholdery i treści generowane dynamicznie w JS.
   Kolejne języki: dodaj nowy klucz w RT_RULES (np. de: [...]) w tym samym formacie. */
(function () {
  'use strict';

  // [wzorzec (string lub RegExp), zamiennik]. Stringi są zamieniane globalnie; dłuższe frazy mają pierwszeństwo.
  const RT_RULES = {
    ru: [
      // — czat AI / szybkie pytania —
      ['Cześć! 👋 Jestem AI asystentem', 'Привет! 👋 Я ИИ-ассистент'],
      ['Pytaj o dowolną funkcję aplikacji, albo po prostu pogadajmy!', 'Спрашивай о любой функции приложения или просто поболтаем!'],
      ['Głosowe odpowiedzi', 'Голосовые ответы'], ['Wyczyść czat', 'Очистить чат'],
      // — kamera / chroma / nagrywanie —
      ['Włącz kamerę aby zacząć', 'Включи камеру, чтобы начать'],
      ['Zrób zdjęcie', 'Сделать фото'], ['Nagraj wideo', 'Записать видео'],
      ['Białe tło', 'Белый фон'], ['Czarne tło', 'Чёрный фон'],
      ['Pełny ekran (lub dwuklik)', 'Полный экран (или двойной клик)'],
      ['klatek/s (płynny)', 'кадров/с (плавно)'], ['klatek/s (wymaga obsługi kamery)', 'кадров/с (нужна поддержка камеры)'],
      ['Zmienia barwę bez zmiany tonu', 'Меняет тембр без изменения высоты тона'],
      ['Pulsowanie głośności', 'Пульсация громкости'], ['Porównaj oryginał / efekt', 'Сравнить оригинал / эффект'],
      ['· kliknij A/B aby przełączyć', '· нажми A/B для переключения'],
      ['Wycisz dźwięk', 'Выключить звук'], ['Pętla', 'Цикл'],
      ['Głęboki', 'Глубокий'], ['Wiewiórka', 'Белка'],
      // — kolory / ustawienia —
      ['Różowy głęboki', 'Насыщенно-розовый'], ['Pomarańczowy', 'Оранжевый'], ['Szkarłatny', 'Алый'],
      ['Błękitny', 'Голубой'], ['Brązowy', 'Коричневый'], ['Żółty', 'Жёлтый'], ['Biały', 'Белый'],
      ['Własny kolor', 'Свой цвет'], ['Resetuj do domyślnych', 'Сбросить по умолчанию'], ['Zamknij (Esc)', 'Закрыть (Esc)'],
      ['Ustawienia', 'Настройки'],
      // — FPS —
      ['CZAS POWYŻEJ CELU', 'ВРЕМЯ ВЫШЕ ЦЕЛИ'], ['PRÓBKI:', 'ВЫБОРКИ:'],
      [/śr\. (\d+) fps/g, 'ср. $1 fps'], ['fps śr.', 'fps ср.'],
      // — monitor wydajności —
      ['▶ Uruchom benchmark (5M operacji)', '▶ Запустить бенчмарк (5M операций)'],
      ['długich zadań (>50ms) — przeglądarka może się zacinać', 'длинных задач (>50мс) — браузер может подтормаживать'],
      ['▶ Uruchom test multi-core', '▶ Запустить мультиядерный тест'],
      ['Thermal API niedostępne', 'Thermal API недоступен'],
      [/Ładuje · pełna za (\d+) min/g, 'Заряжается · полная через $1 мин'],
      ['Niskie — przeglądarka działa płynnie', 'Низкая — браузер работает плавно'],
      ['Software renderer — brak GPU sprzętowego', 'Программный рендерер — нет аппаратного GPU'],
      ['📈 MONITOR WYDAJNOŚCI', '📈 МОНИТОР ПРОИЗВОДИТЕЛЬНОСТИ'],
      // — raport / sysinfo —
      ['Śr. FPS', 'Ср. FPS'], ['Rozdzielczość', 'Разрешение'], ['Przeglądarka', 'Браузер'], ['Język systemu', 'Язык системы'],
      ['Wartość z navigator.deviceMemory', 'Значение из navigator.deviceMemory'],
      ['Głębia koloru', 'Глубина цвета'], ['Dostępna:', 'Доступно:'], ['Dostępne:', 'Доступно:'], ['Użyto:', 'Использовано:'],
      ['Ekran dotykowy', 'Сенсорный экран'], ['Żyroskop', 'Гироскоп'], ['Akcelerometr', 'Акселерометр'],
      ['Języki:', 'Языки:'], ['Język:', 'Язык:'], ['Włączone', 'Включены'],
      ['% (ładuje)', '% (заряжается)'], ['⚡ Ładowanie', '⚡ Зарядка'],
      [/❌ Nie(?![a-ząćęłńóśźż])/g, '❌ Нет'], [/✅ Tak(?![a-ząćęłńóśźż])/g, '✅ Да'],
      // — głośniki —
      ['Sprawdź ustawienia przeglądarki.', 'Проверь настройки браузера.'],
      ['Środek (C)', 'Центр (C)'], ['Wyższy mid', 'Верхняя середина'], ['Obecność', 'Присутствие'], ['Limit słuchu', 'Предел слуха'],
      [/^Środek$/g, 'Центр'], ['↺ ODŚWIEŻ', '↺ ОБНОВИТЬ'],
      // — router / wifi —
      ['(routery, smartfony, TV...) otwórz w routerze panel administracyjny pod adresem', '(роутеры, смартфоны, ТВ...) открой в роутере админ-панель по адресу'],
      ['lub użyj aplikacji', 'или используй приложение'],
      [/^mało$/g, 'мало'], [/^średnio$/g, 'средне'], [/^dużo$/g, 'много'],
      // — mikrofon —
      ['Mikrofon ON', 'Микрофон ВКЛ'], ['Urządzenie', 'Устройство'], ['Próbkowanie', 'Частота дискретизации'],
      ['Kanały', 'Каналы'], ['Opóźnienie', 'Задержка'], ['Tłumienie szumów', 'Шумоподавление'], ['Głębia bitowa', 'Разрядность'],
      ['Echo cancellation: NIE', 'Эхоподавление: НЕТ'], ['Echo cancellation: TAK', 'Эхоподавление: ДА'],
      ['Brak sygnału', 'Нет сигнала'], ['Bardzo głośno', 'Очень громко'],
      ['Świetny poziom sygnału', 'Отличный уровень сигнала'], ['Idealne do nagrań', 'Идеально для записи'],
      ['Za głośno — oddal się od mikrofonu', 'Слишком громко — отодвинься от микрофона'],
      ['❌ Wyłączona', '❌ Выключено'], ['❌ Wyłączone', '❌ Выключено'], ['✅ Włączona', '✅ Включено'], ['✅ Włączone', '✅ Включено'],
      // — internet / logi —
      ['Test Internetu', 'Тест интернета'],
      ['⚠️ Wszystkie IP API niedostępne — prawdopodobnie adblocker lub VPN blokuje requesty do zewnętrznych serwisów', '⚠️ Все IP API недоступны — вероятно, adblocker или VPN блокирует запросы к внешним сервисам'],
      ['ℹ️ Test prędkości (START) działa niezależnie — możesz go uruchomić normalnie', 'ℹ️ Тест скорости (START) работает независимо — можно запускать как обычно'],
      ['Panel otwarty — naciśnij START', 'Панель открыта — нажми START'],
      ['Połączenie:', 'Соединение:'], ['Prędkość wg przeglądarki', 'Скорость по данным браузера'],
      ['Nie udało się pobrać danych', 'Не удалось получить данные'], ['Niedostępne', 'Недоступно'],
      // — CSP —
      ['🌐 Skanuj przez proxy', '🌐 Сканировать через прокси'], ['🔍 Skanuj', '🔍 Сканировать'],
      ['✅ Dobra konfiguracja — brak oczywistych problemów', '✅ Хорошая конфигурация — очевидных проблем нет'],
      ['Naciśnij START, potem naciskaj klawisze', 'Нажми START, затем нажимай клавиши'],
      ['sprawdź mikrofon', 'проверь микрофон'], ['Nic nie słyszę', 'Ничего не слышу'],
      // === WAVE 2: teksty z kodu (statusy, wyniki, opisy) ===
      ['niedostępna dla tej kamery', 'недоступно для этой камеры'],
      ['Kamera obsługuje max', 'Камера поддерживает макс.'], ['prosiłeś o', 'запрошено'],
      ['— (wyłączona)', '— (выключена)'],
      ['Bardzo głośno', 'Очень громко'], ['Głośno', 'Громко'],
      ['Nieznane', 'Неизвестно'],
      ['🔇 Brak sygnału — sprawdź mikrofon', '🔇 Нет сигнала — проверь микрофон'],
      ['🔴 Przesterowanie! Zbyt głośno', '🔴 Перегрузка! Слишком громко'], ['Oddal się od mikrofonu', 'Отодвинься от микрофона'],
      ['⚡ Dobry sygnał', '⚡ Хороший сигнал'], ['Możesz mówić głośniej', 'Можно говорить громче'],
      ['⚠️ Słaby sygnał', '⚠️ Слабый сигнал'], ['Przybliż się do mikrofonu', 'Приблизься к микрофону'],
      ['Wszystkie API zawiodły', 'Все API дали сбой'],
      ['(dokładny)', '(точное)'], ['(lokalizacja ISP — może się różnić)', '(локация провайдера — может отличаться)'],
      ['(IP wychodzące przez', '(исходящий IP через'],
      ['test prędkości mierzy łącze VPN', 'тест скорости измеряет канал VPN'],
      ['📱 Komórkowe', '📱 Мобильная сеть'], ['🔋 Oszczędzanie danych ON', '🔋 Экономия трафика ВКЛ'],
      ['Network Information API niedostępne (Firefox/Safari)', 'Network Information API недоступен (Firefox/Safari)'],
      ['Network Information API niedostępne', 'Network Information API недоступен'],
      ['— (brak nagłówków)', '— (нет заголовков)'],
      ['Naciśnij START', 'Нажми START'],
      ['⬇️ Brak dostępnego serwera testowego. Pobieranie niedostępne z tej domeny.', '⬇️ Нет доступного тестового сервера. Загрузка недоступна с этого домена.'],
      ['(ograniczona przepustowość)', '(ограниченная пропускная способность)'],
      ['⬆️ Brak endpointu upload. Dodaj funkcję Netlify:', '⬆️ Нет endpoint для upload. Добавь функцию Netlify:'],
      ['⚠️ Błąd testu:', '⚠️ Ошибка теста:'], ['❌ Błąd testu:', '❌ Ошибка теста:'],
      ['❌ Urządzenie jest offline — sprawdź połączenie', '❌ Устройство офлайн — проверь соединение'],
      ['▶ Test rozpoczęty', '▶ Тест начат'], ['📡 Mierzę ping...', '📡 Измеряю пинг...'],
      ['doskonały', 'отличный'], ['dobry', 'хороший'], ['wysoki', 'высокий'],
      ['⬇️ Mierzę pobieranie...', '⬇️ Измеряю загрузку...'], ['⬆️ Mierzę wysyłanie...', '⬆️ Измеряю отправку...'],
      ['⬆️ Wysyłanie — 25 sek.', '⬆️ Отправка — 25 сек.'], ['Wysyłanie:', 'Отправка:'],
      ['✅ Test zakończony', '✅ Тест завершён'],
      ['❌ Za słabe', '❌ Слишком слабо'], ['✅ Świetnie', '✅ Отлично'], ['✅ Płynnie', '✅ Плавно'],
      ['⚡ Możliwe', '⚡ Возможно'], ['⚡ Wystarczające', '⚡ Достаточно'],
      ['Wolne deploye', 'Медленные деплои'], ['Idealne', 'Идеально'], ['Wystarczające', 'Достаточно'],
      ['🏆 Doskonałe', '🏆 Превосходно'], ['⚡ Przeciętne', '⚡ Средне'], ['❌ Słabe', '❌ Слабо'],
      ['Doskonałe', 'Превосходно'], ['Dobre', 'Хорошо'], ['Przeciętne', 'Средне'], ['Słabe', 'Слабо'],
      ['✅ Wynik:', '✅ Результат:'],
      ['Podwyższona', 'Повышенная'], ['pełna za', 'полная через'], [/\bmin\b/g, 'мин'],
      ['ładuje...', 'заряжается...'], ['⚡ Ładuje', '⚡ Заряжается'], ['Ładuje się (może być cieplej)', 'Заряжается (может быть теплее)'],
      ['Thermal API niedostępne', 'Thermal API недоступен'], ['API niedostępne', 'API недоступно'], ['WebGL niedostępny', 'WebGL недоступен'],
      ['Błąd WebGL', 'Ошибка WebGL'],
      ['Wysokie — może powodować spadki FPS', 'Высокая — может вызывать просадки FPS'],
      ['🟢 działa', '🟢 работает'],
      ['Brak danych (strona lokalna lub brak zasobów)', 'Нет данных (локальная страница или нет ресурсов)'],
      ['🟡 Testowanie multi-core', '🟡 Тест multi-core'], ['wątków', 'потоков'],
      ['🚀 Doskonałe skalowanie', '🚀 Отличное масштабирование'], ['⚠️ Słabe skalowanie', '⚠️ Слабое масштабирование'],
      ['⏹ WYŁĄCZ KAMERĘ', '⏹ ВЫКЛЮЧИТЬ КАМЕРУ'], ['▶ WŁĄCZ KAMERĘ', '▶ ВКЛЮЧИТЬ КАМЕРУ'],
      ['Brak głosu dla języka', 'Нет голоса для языка'], ['— TTS wyłączone dla tej wiadomości', '— TTS отключён для этого сообщения'],
      ['— Nowa rozmowa —', '— Новый разговор —'], ['Czat wyczyszczony! 🗑️ O czym chcesz pogadać?', 'Чат очищен! 🗑️ О чём хочешь поговорить?'],
      ['WebRTC zablokowane — brak lokalnego IP.', 'WebRTC заблокирован — нет локального IP.'], ['Sprawdź ustawienia przeglądarki.', 'Проверь настройки браузера.'],
      ['💻 To urządzenie (LAN IP)', '💻 Это устройство (LAN IP)'], ['Twój komputer · lokalne IP', 'Твой компьютер · локальный IP'],
      ['Brama domyślna sieci', 'Шлюз сети по умолчанию'], ['Brama domyślna ·', 'Шлюз по умолчанию ·'],
      ['🏷️ Rozwiązuję nazwy...', '🏷️ Определяю имена...'], ['✅ Znaleziono', '✅ Найдено'], ['urządzeń/interfejsów', 'устройств/интерфейсов'],
      ['Dodatkowy punkt dostępu', 'Дополнительная точка доступа'], ['Bardzo niskie opóźnienie', 'Очень низкая задержка'],
      ['💻 Urządzenie lokalne', '💻 Локальное устройство'], ['Sieć lokalna', 'Локальная сеть'],
      ['❓ Nieznane urządzenie', '❓ Неизвестное устройство'], ['Urządzenie sieciowe', 'Сетевое устройство'],
      ['👍 Przeciętny słuch', '👍 Средний слух'], ['👍 Przeciętny', '👍 Средне'], ['🐢 Poniżej średniej', '🐢 Ниже среднего'],
      ['Średnia', 'Среднее'], ['Szum tła', 'Фоновый шум'],
      ['🏆 Doskonały — pełne Hz monitora', '🏆 Отлично — полная частота монитора'],
      ['🏃 Płynny gaming (90+ fps)', '🏃 Плавный гейминг (90+ fps)'], ['❌ Słaby — widoczne zacinanie', '❌ Плохо — заметные подтормаживания'],
      ['Śr. czas klatki', 'Ср. время кадра'], ['Stabilność', 'Стабильность'], ['Próbki', 'Выборки'], ['Monitor wydajności', 'Монитор производительности'],
      ['Kliknięcia', 'Клики'], ['Celność', 'Точность'], ['⚡ Częściowy (', '⚡ Частично ('], ['❌ Słaby (', '❌ Плохо ('],
      ['Wynik bezpieczeństwa', 'Оценка безопасности'],
      ['Brak danych — najpierw uruchom kilka testów', 'Нет данных — сначала запусти несколько тестов'],
      ['Naciśnij SPACJĘ aby zacząć / zareagować', 'Нажми ПРОБЕЛ, чтобы начать / среагировать'],
      ['Naciśnij ← lub → gdy pojawi się strzałka  ·  SPACJA = start', 'Нажми ← или →, когда появится стрелка  ·  ПРОБЕЛ = старт'],
      ['Naciśnij ← lub → gdy pojawi się strzałka · SPACJA = start', 'Нажми ← или →, когда появится стрелка · ПРОБЕЛ = старт'],
      ['Czekaj na strzałkę…', 'Жди стрелку…'], ['Za wcześnie! Poczekaj na zielony', 'Слишком рано! Дождись зелёного'], ['Za wcześnie!', 'Слишком рано!'],
      ['ms — za szybko, spróbuj ponownie', 'мс — слишком быстро, попробуй ещё раз'],
      ['Zły kierunek!', 'Не то направление!'], ['Czekaj na zielony sygnał…', 'Жди зелёный сигнал…'],
      ['Spacja — spróbuj ponownie', 'Пробел — попробовать снова'], ['Spacja — aby zacząć · ← → gdy strzałka', 'Пробел — начать · ← → когда стрелка'],
      ['Spacja — aby zacząć', 'Пробел — начать'], ['Kliknij, aby spróbować ponownie', 'Нажми, чтобы попробовать снова'], ['Kliknij, aby zacząć', 'Нажми, чтобы начать'],
      ['Poniżej śred.', 'Ниже сред.'], ['Przeciętny', 'Средний'], ['Spróbuj ponownie', 'Попробуй ещё раз'],
      ['Próba ', 'Попытка '],
      ['Nagrano — kliknij ▶ aby odtworzyć', 'Записано — нажми ▶ для воспроизведения'], ['⏳ Renderuję...', '⏳ Рендерю...'],
      ['ORYGINAŁ', 'ОРИГИНАЛ'], ['Kliknij aby nagrywać', 'Нажми, чтобы записать'],
      ['⬅️ Lewy kanał gra', '⬅️ Играет левый канал'], ['🔊 Środek gra', '🔊 Играет центр'], ['Prawy kanał gra ➡️', 'Играет правый канал ➡️'],
      ['Kliknij kanał aby przetestować', 'Нажми на канал для теста'],
      ['❌ Brak słyszalnych tonów — sprawdź głośność', '❌ Нет слышимых тонов — проверь громкость'],
      ['🏆 Doskonały słuch!', '🏆 Отличный слух!'], ['✅ Dobry słuch', '✅ Хороший слух'],
      ['⚠️ Słaby słuch — rozważ badanie', '⚠️ Слабый слух — подумай о проверке у врача'], ['❌ Bardzo słaby słuch', '❌ Очень слабый слух'],
      ['słyszysz do', 'слышишь до'], ['tonów', 'тонов'],
      ['WebRTC zablokowany lub niedostępny (VPN może blokować STUN)', 'WebRTC заблокирован или недоступен (VPN может блокировать STUN)'],
      ['— (Network API niedostępne)', '— (Network API недоступен)'],
      ['Sieć domowa (klasa C)', 'Домашняя сеть (класс C)'], ['Sieć prywatna (klasa A)', 'Частная сеть (класс A)'], ['Sieć prywatna (klasa B)', 'Частная сеть (класс B)'],
      ['przesuń mysz lub kliknij', 'двигай мышь или кликай'],
      ['Klikaj tutaj żeby zobaczyć heatmapę', 'Кликай здесь, чтобы увидеть тепловую карту'], ['Środkowy', 'Средняя'],
      ['Kliknij przyciski myszy', 'Нажимай кнопки мыши'],
      ['Kliknięć:', 'Кликов:'], ['pkt | Celność:', 'очк. | Точность:'],
      ['Naciśnij START żeby zacząć', 'Нажми START, чтобы начать'],
      ['Czekam na dane...', 'Ожидание данных...'],
      ['⚠️ API ograniczone do 8 GB (prywatność). Rzeczywisty RAM może być 16/32/64 GB.', '⚠️ API ограничено 8 ГБ (приватность). Реальная RAM может быть 16/32/64 ГБ.'],
      ['⚠️ API celowo ograniczone do 8 GB (Chrome/Firefox blokuje dla prywatności). Twoja rzeczywista ilość RAM może być większa (np. 16/32/64 GB).', '⚠️ API намеренно ограничено 8 ГБ (Chrome/Firefox блокируют ради приватности). Реальный объём RAM может быть больше (напр. 16/32/64 ГБ).'],
      ['API niedostępne w tej przeglądarce.', 'API недоступно в этом браузере.'],
      ['WebGL dostępny (info GPU zablokowane przez przeglądarkę)', 'WebGL доступен (инфо о GPU заблокировано браузером)'],
      ['❌ WebGL niedostępny', '❌ WebGL недоступен'], ['WebGL dostępny', 'WebGL доступен'], ['Błąd:', 'Ошибка:'],
      ['⚠️ Tryb oszczędny danych', '⚠️ Режим экономии трафика'],
      ['Online (Network Info API niedostępne)', 'Онлайн (Network Info API недоступен)'], ['Online (brak szczegółów)', 'Онлайн (нет подробностей)'],
      ['🔋 Na baterii', '🔋 От батареи'],
      ['Brak API (desktop) lub niedostępne', 'Нет API (десктоп) или недоступно'],
      ['Logiczna:', 'Логическое:'], ['Fizyczna:', 'Физическое:'], ['Orientacja:', 'Ориентация:'], ['Wartość z navigator.deviceMemory (GB).', 'Значение из navigator.deviceMemory (ГБ).'],
      ['Cookies:', 'Cookies:'], ['❌ Wyłączone', '❌ Выключены'],
      ['🫧 Bąbelki', '🫧 Пузыри'], ['🌀 Sprężyna', '🌀 Пружина'], ['🥁 Bęben', '🥁 Барабан'], ['🥂 Szkło', '🥂 Стекло'], ['🎤 Chór', '🎤 Хор'], ['🐸 Żaba', '🐸 Лягушка'],
      ['Pauza — naciśnij START aby kontynuować', 'Пауза — нажми START, чтобы продолжить'],
      ['Wyłącz odsłuch głosu', 'Выключить прослушку голоса'], ['Włącz odsłuch głosu', 'Включить прослушку голоса'],
      [/^Wyłącz$/g, 'Выключить'], [/^Wł$/g, 'Вкл'], [/^Wył$/g, 'Выкл'],
      ['✅ Świetny', '✅ Отлично'], ['SNR', 'SNR'], ['profesjonalna jakość', 'профессиональное качество'],
      ['⚠️ Słaby', '⚠️ Слабо'], ['Dużo szumu tła — spróbuj wzmocnić głos', 'Много фонового шума — попробуй говорить громче'],
      ['🔴 Przesterowanie! Oddal się od mikrofonu lub zmniejsz głośność wejścia.', '🔴 Перегрузка! Отодвинься от микрофона или уменьши входную громкость.'],
      ['🔇 Bardzo dużo szumu tła. Spróbuj nagrywać w cichszym miejscu lub użyj Bramki szumu.', '🔇 Очень много фонового шума. Попробуй записывать в более тихом месте или включи шумовой гейт.'],
      ['⚠️ Widoczny szum tła. Zwiększ głośność głosu lub zbliż się do mikrofonu.', '⚠️ Заметен фоновый шум. Говори громче или приблизься к микрофону.'],
      ['📢 Mówisz zbyt cicho. Zbliż się do mikrofonu lub zwiększ wzmocnienie.', '📢 Ты говоришь слишком тихо. Приблизься к микрофону или увеличь усиление.'],
      ['✅ Doskonały sygnał! Jakość nagrania jest profesjonalna.', '✅ Отличный сигнал! Качество записи профессиональное.'],
      ['🎚️ Duży zakres dynamiki. Możesz użyć kompresora aby wyrównać głośność.', '🎚️ Большой динамический диапазон. Можно использовать компрессор для выравнивания громкости.'],
      ['Redukcja echa', 'Подавление эха'], ['Auto-wzmocnienie', 'Автоусиление'],
      ['✅ Włączona', '✅ Включено'],
      ['⚠️ Ograniczenie przeglądarki:', '⚠️ Ограничение браузера:'], ['Ograniczenie przeglądarki:', 'Ограничение браузера:'],
      ['Strona nie może uzyskać listy urządzeń sieciowych. Widoczne jest tylko Twoje połączenie.', 'Страница не может получить список сетевых устройств. Видно только твоё соединение.'],
      ['❌ Błąd:', '❌ Ошибка:'], ['❌ Brak rekordów lub domena nie istnieje', '❌ Нет записей или домен не существует'],
      ["osłabia ochronę XSS", 'ослабляет защиту от XSS'],
      ['Żadnych nagłówków security.', 'Нет заголовков безопасности.'],
      ['⏱ Timeout — proxy nie odpowiedział', '⏱ Таймаут — прокси не ответил'], ['❌ Proxy niedostępne — spróbuj innego', '❌ Прокси недоступен — попробуй другой'],
      ['🔍 Pobieram nagłówki...', '🔍 Получаю заголовки...'],
      ['Fallback dla pozostałych dyrektyw', 'Запасное значение для остальных директив'],
      ['Skąd można ładować JavaScript', 'Откуда можно загружать JavaScript'], ['Skąd można ładować CSS', 'Откуда можно загружать CSS'],
      ['Skąd można ładować obrazy', 'Откуда можно загружать изображения'], ['Dozwolone połączenia (fetch, XHR, WebSocket)', 'Разрешённые соединения (fetch, XHR, WebSocket)'],
      ['Skąd można ładować czcionki', 'Откуда можно загружать шрифты'], ['Dozwolone źródła dla <iframe>', 'Разрешённые источники для <iframe>'],
      ['Dozwolone wartości <base href>', 'Разрешённые значения <base href>'], ['Gdzie formularz może POST', 'Куда форма может отправлять POST'],
      ['Kto może osadzić tę stronę w iframe', 'Кто может встраивать эту страницу в iframe'],
      ['Endpoint raportów (stary)', 'Endpoint отчётов (старый)'], ['Endpoint raportów (nowy)', 'Endpoint отчётов (новый)'],
      ["pozwala wstrzyknąć dowolny JS — zastąp nonce/hash", "позволяет внедрить любой JS — замени на nonce/hash"],
      ["pozwala uruchamiać eval() — niebezpieczne dla XSS", "позволяет запускать eval() — опасно для XSS"],
      ['Wildcard * = brak ograniczeń źródła skryptów', 'Wildcard * = нет ограничений на источники скриптов'],
      ["Ustaw 'none' by zablokować Flash/pluginy", "Установи 'none', чтобы заблокировать Flash/плагины"],
      ['Brak base-uri pozwala zmienić bazowy URL (atak)', 'Отсутствие base-uri позволяет изменить базовый URL (атака)'],
      ['Automatyczny upgrade HTTP→HTTPS dla zasobów', 'Автоматический апгрейд HTTP→HTTPS для ресурсов'],
      ["Nowoczesne podejście zamiast", "Современный подход вместо"],
      ['Report-Only tylko raportuje, nie blokuje — zmień na CSP', 'Report-Only только сообщает, не блокирует — замени на CSP'],
      ['❌ Brak nagłówka Content-Security-Policy!', '❌ Нет заголовка Content-Security-Policy!'],
      ['⚠️ CORS blokuje dostęp — serwer nie zezwala na cross-origin HEAD', '⚠️ CORS блокирует доступ — сервер не разрешает cross-origin HEAD'],
      ['Nie można odczytać nagłówków.', 'Не удалось прочитать заголовки.'],
      ['Serwer blokuje żądania HEAD z innych domen.', 'Сервер блокирует HEAD-запросы с других доменов.'],
      ['Działa zawsze dla tej samej domeny (np. Twoja strona na Netlify).', 'Всегда работает для того же домена (напр. твой сайт на Netlify).'],
      ['⏱ Timeout — serwer nie odpowiedział w 8 sekund', '⏱ Таймаут — сервер не ответил за 8 секунд'],
      ['🔴 Przesterowanie! Oddal się od mikrofonu lub zmniejsz głośność wejścia', '🔴 Перегрузка! Отодвинься от микрофона или уменьши входную громкость'],
      ['Ekran dotykowy', 'Сенсорный экран'], ['Ekran', 'Экран'],
      // === WAVE 3: frazy ===
      ['KLIPOWANIE', 'КЛИППИНГ'], ['Z CACHE', 'ИЗ КЭША'], ['MS/FRAME', 'МС/КАДР'], ['DROPPED:', 'ПРОПУЩЕНО:'], ['SPIKES:', 'ПИКИ:'],
      ['(5M operacji)', '(5M операций)'], ['🌈 Gradient', '🌈 Градиент'], ['💎 Pryzmat', '💎 Призма'], ['📶 WiFi (szybkie)', '📶 WiFi (быстрый)'],
      ['⌨️ Spacja', '⌨️ Пробел'],
      ['🏓 Ping Pong', '🏓 Пинг-понг'],
      ["♟ Szachownica", "♟ Шахматка"],
      ["▪ Drobna", "▪ Мелкая"],
      ["⊞ Siatka", "⊞ Сетка"],
      ["◎ Koncentryki", "◎ Круги"],
      ["🟥 Paski SMPTE", "🟥 Полосы SMPTE"],
      ["🔴 Jeden piksel", "🔴 Один пиксель"],
      ["📌 Pinnij", "📌 Закрепить"],
      ["Przypnij HUD", "Закрепить HUD"],
      ["↺ Reset", "↺ Сброс"],
      ["↺ RESET", "↺ СБРОС"],
      ["RESET PEAK", "СБРОС ПИКА"],
      ["Niebieski ekran", "Синий экран"],
      ["Zielony ekran", "Зелёный экран"],
      ["Szary 50%", "Серый 50%"],
      ["% klatek w zakresie", "% кадров в диапазоне"],
      ["* (wszystkie)", "* (все)"],
      ["0 / 0 klawiszy", "0 / 0 клавиш"],
      ["0 / 104 klawiszy", "0 / 104 клавиш"],
      ["wszystkich klawiszy", "всех клавиш"],
      ["0% limitu", "0% лимита"],
      ["— % limitu", "— % лимита"],
      ["1400×900 px fizycznych", "1400×900 px физических"],
      ["fizycznych", "физических"],
      ["2 — Stereo", "2 — Стерео"],
      ["24 klatki/s (filmowy)", "24 кадра/с (кино)"],
      ["30 klatek/s (standard)", "30 кадров/с (стандарт)"],
      ["klatek/s", "кадров/с"],
      ["(nieszyfrowane)", "(без шифрования)"],
      ["AI Asystent StudioTest", "ИИ-ассистент StudioTest"],
      ["ANALIZA PASM", "АНАЛИЗ ПОЛОС"],
      ["CDN / SERWER", "CDN / СЕРВЕР"],
      ["CREATED BY", "СОЗДАЛ"],
      ["CZAS TESTU", "ВРЕМЯ ТЕСТА"],
      ["CZAS:", "ВРЕМЯ:"],
      ["Czas:", "Время:"],
      ["Cel:", "Цель:"],
      ["brak wsparcia", "нет поддержки"],
      ["DANE TECHNICZNE", "ТЕХНИЧЕСКИЕ ДАННЫЕ"],
      ["Dobry zakres", "Хороший диапазон"],
      ["Efekty specjalne", "Спецэффекты"],
      ["FRAME TIME", "ВРЕМЯ КАДРА"],
      ["Fala:", "Волна:"],
      ["Filtry CSS", "CSS-фильтры"],
      ["Historia poziomu", "История уровня"],
      ["IP PUBLICZNY (IPv4)", "ПУБЛИЧНЫЙ IP (IPv4)"],
      ["Informacje o mikrofonie", "Информация о микрофоне"],
      ["JITTER PINGU", "ДЖИТТЕР ПИНГА"],
      ["Kalibrowanie...", "Калибровка..."],
      ["Korektor graficzny (EQ) — 10 pasm", "Графический эквалайзер (EQ) — 10 полос"],
      ["Lewy (L)", "Левый (L)"],
      ["Prawy (R)", "Правый (R)"],
      ["Prawy ➡", "Правый ➡"],
      ["⬅ Lewy", "⬅ Левый"],
      ["Losuj preset i suwaki", "Случайный пресет и ползунки"],
      ["Nagrywanie wideo", "Запись видео"],
      ["Niski bas", "Низкий бас"],
      ["O aplikacji", "О приложении"],
      ["OSTATNI KLAWISZ", "ПОСЛЕДНЯЯ КЛАВИША"],
      ["PIKSELE EKRANU", "ПИКСЕЛИ ЭКРАНА"],
      ["POLE RUCHU", "ПОЛЕ ДВИЖЕНИЯ"],
      ["POZIOM RMS", "УРОВЕНЬ RMS"],
      ["PRESET:", "ПРЕСЕТ:"],
      ["Producent:", "Производитель:"],
      ["Pulsowanie tonu", "Пульсация тона"],
      ["Punkty dotyku", "Точки касания"],
      ["RAM (deklarowana)", "RAM (заявленная)"],
      ["RDZENIE CPU", "ЯДРА CPU"],
      ["Rdzenie CPU", "Ядра CPU"],
      ["Raport sesji", "Отчёт сессии"],
      ["Rozszerzenie stereo", "Расширение стерео"],
      ["STAN TERMICZNY CPU", "ТЕПЛОВОЕ СОСТОЯНИЕ CPU"],
      ["Silnik:", "Движок:"],
      ["Skuteczne:", "Эффективное:"],
      ["Strefa czasowa", "Часовой пояс"],
      ["Strefa:", "Пояс:"],
      ["Testowanie...", "Тестирование..."],
      ["Ultra-wyso", "Ультра-высокий"],
      ["Utracone:", "Потеряно:"],
      ["WYNIK MULTI", "РЕЗУЛЬТАТ MULTI"],
      ["WYNIK SINGLE", "РЕЗУЛЬТАТ SINGLE"],
      ["Wykrywanie przez WebRTC...", "Определение через WebRTC..."],
      ["Wykrywanie...", "Определение..."],
      ["ZAKRES DYNAMIKI", "ДИНАМИЧЕСКИЙ ДИАПАЗОН"],
      ["Zrzut ekranu", "Скриншот"],
      ["czeka na dane...", "ожидание данных..."],
      ["dB (szczyt − szum)", "дБ (пик − шум)"],
      ["ms (½ czasu klatki)", "мс (½ времени кадра)"],
      ["ms / klatka", "мс / кадр"],
      ["ostatnie 5 sek.", "последние 5 сек."],
      ["tryb report-only", "режим report-only"],
      ["— (VPN / adblocker blokuje API)", "— (VPN / adblocker блокирует API)"],
      ["— (brak danych)", "— (нет данных)"],
      ["— wykrywanie...", "— определение..."],
      ["— (plik lokalny / CORS)", "— (локальный файл / CORS)"],
      ["↔ Lustro", "↔ Зеркало"],
      ["⌛ ESTYM. INPUT LAG", "⌛ ОЦЕНКА INPUT LAG"],
      ["⏱ HISTORIA FPS — OSTATNIE 60 SEK", "⏱ ИСТОРИЯ FPS — ПОСЛЕДНИЕ 60 СЕК"],
      ["⏸ zatrzymany", "⏸ остановлен"],
      ["⏺ NAGRAJ", "⏺ ЗАПИСАТЬ"],
      ["▶ Boczny 5", "▶ Боковая 5"],
      ["◀ Boczny 4", "◀ Боковая 4"],
      ["▶ Graj ton", "▶ Играть тон"],
      ["⚙️ SYSTEM OPERACYJNY", "⚙️ ОПЕРАЦИОННАЯ СИСТЕМА"],
      ["⚠️ Wykryto", "⚠️ Обнаружено"],
      ["⚡ BENCHMARK CPU (JS)", "⚡ БЕНЧМАРК CPU (JS)"],
      ["⬜ Szary", "⬜ Серый"],
      ["✏️ Szkic", "✏️ Эскиз"],
      ["✨ Gwiazdy", "✨ Звёзды"],
      ["✨ Jasny", "✨ Яркий"],
      ["✨ Wibrafon", "✨ Вибрафон"],
      ["✨ EFEKTY", "✨ ЭФФЕКТЫ"],
      ["❄️ Zimny", "❄️ Холодный"],
      ["❤️ Serduszka", "❤️ Сердечки"],
      ["⬇ POBIERZ HTML", "⬇ СКАЧАТЬ HTML"],
      ["⬇ POBIERZ NAGRANIE", "⬇ СКАЧАТЬ ЗАПИСЬ"],
      ["⬛ 4x Lustro", "⬛ 4x Зеркало"],
      ["🔳 9x Lustro", "🔳 9x Зеркало"],
      ["🌀 Kalejdoskop", "🌀 Калейдоскоп"],
      ["🌊 Podwodny", "🌊 Под водой"],
      ["🌊 Syrena", "🌊 Сирена"],
      ["🌊 Warp fala", "🌊 Волновой варп"],
      ["🌊 Woda", "🌊 Вода"],
      ["🌍 Adres IP", "🌍 IP-адрес"],
      ["🌐 POPULARNE STRONY", "🌐 ПОПУЛЯРНЫЕ САЙТЫ"],
      ["🌡 Termowizor", "🌡 Тепловизор"],
      ["🌡️ TEMPERATURY I STAN TERMICZNY", "🌡️ ТЕМПЕРАТУРЫ И ТЕПЛОВОЕ СОСТОЯНИЕ"],
      ["🌡️ Termiczny", "🌡️ Тепловой"],
      ["🌡️ Termo", "🌡️ Термо"],
      ["🌧️ Deszcz", "🌧️ Дождь"],
      ["🌧️ Kropla", "🌧️ Капля"],
      ["🌬️ Szept", "🌬️ Шёпот"],
      ["🍺 Pijany", "🍺 Пьяный"],
      ["🎊 Konfetti", "🎊 Конфетти"],
      ["🎤 Normalny", "🎤 Обычный"],
      ["🎞️ Stary film", "🎞️ Старая плёнка"],
      ["🎨 Olej", "🎨 Масло"],
      ["🎭 Dramat", "🎭 Драма"],
      ["🎮 Gry online", "🎮 Онлайн-игры"],
      ["🎵 Flet", "🎵 Флейта"],
      ["🎵 Ksylofon", "🎵 Ксилофон"],
      ["🎶 Harfa", "🎶 Арфа"],
      ["🎸 Gitara", "🎸 Гитара"],
      ["🎻 Sala", "🎻 Зал"],
      ["🏔️ Grota", "🏔️ Грот"],
      ["🏟️ Stadion", "🏟️ Стадион"],
      ["🐟 Rybie oko", "🐟 Рыбий глаз"],
      ["🐭 Mysz", "🐭 Мышь"],
      ["👴 Staruszek", "👴 Старик"],
      ["👶 Dziecko", "👶 Ребёнок"],
      ["👹 Niski", "👹 Низкий"],
      ["👻 Duch", "👻 Призрак"],
      ["👽 Kosmita", "👽 Инопланетянин"],
      ["💥 Komiks", "💥 Комикс"],
      ["💡 OBRAZ", "💡 ИЗОБРАЖЕНИЕ"],
      ["💻 Laptop", "💻 Ноутбук"],
      ["💻 SYSTEM", "💻 СИСТЕМА"],
      ["📄 Kopiuj _headers", "📄 Копировать _headers"],
      ["📈 WYKRES FPS (ostatnie 120 klatek)", "📈 ГРАФИК FPS (последние 120 кадров)"],
      ["📊 Monitor", "📊 Монитор"],
      ["📊 PERCENTYLE", "📊 ПЕРЦЕНТИЛИ"],
      ["📊 RAPORT", "📊 ОТЧЁТ"],
      ["📋 Dziennik", "📋 Журнал"],
      ["📋 KOPIUJ TEKST", "📋 КОПИРОВАТЬ ТЕКСТ"],
      ["📋 Kopiuj CSP", "📋 Копировать CSP"],
      ["📋 Kopiuj", "📋 Копировать"],
      ["📍 Lokalizacja", "📍 Локация"],
      ["📍 Ta strona", "📍 Эта страница"],
      ["📞 Telefon", "📞 Телефон"],
      ["📟 Walkie", "📟 Рация"],
      ["📡 PING LIVE", "📡 ПИНГ LIVE"],
      ["📡 Telegraf", "📡 Телеграф"],
      ["📢 Megafon", "📢 Мегафон"],
      ["📰 Maszyna", "📰 Машинка"],
      ["📶 WiFi lub LTE", "📶 WiFi или LTE"],
      ["📹 Wideokonferencje", "📹 Видеоконференции"],
      ["📺 Skanlinie", "📺 Строки развёртки"],
      ["📺 Streaming 4K", "📺 Стриминг 4K"],
      ["🔁 Negatyw", "🔁 Негатив"],
      ["🔲 Negatyw", "🔲 Негатив"],
      ["🔄 Scroll", "🔄 Прокрутка"],
      ["🔇 Bramka szumu", "🔇 Шумовой гейт"],
      ["🔇 Cisza", "🔇 Тишина"],
      ["🔊 Bass Boost", "🔊 Усиление баса"],
      ["🔍 SKANER", "🔍 СКАНЕР"],
      ["🔍 SZUKAJ", "🔍 ПОИСК"],
      ["🔍 WebRTC — szukam IP...", "🔍 WebRTC — ищу IP..."],
      ["🔍 Zoom puls", "🔍 Пульс зума"],
      ["🔎 ANALIZA", "🔎 АНАЛИЗ"],
      ["🔑 DYREKTYWY", "🔑 ДИРЕКТИВЫ"],
      ["🔔 Dzwonek", "🔔 Звонок"],
      ["🔢 SERWERY DNS (IP)", "🔢 DNS-СЕРВЕРЫ (IP)"],
      ["🔥 STRESS OFF", "🔥 СТРЕСС ВЫКЛ"],
      ["🔩 Metal", "🔩 Металл"],
      ["🔪 Ostry", "🔪 Резкий"],
      ["🔫 Laser", "🔫 Лазер"],
      ["🔲 Inwers", "🔲 Инверсия"],
      ["🔵 Rastr", "🔵 Растр"],
      ["🔵 TRYB A/B — odtwarza", "🔵 РЕЖИМ A/B — воспроизводит"],
      ["🕳️ Jaskinia", "🕳️ Пещера"],
      ["🕳️ Tunel", "🕳️ Туннель"],
      ["🖥️ EKRAN", "🖥️ ЭКРАН"],
      ["🖥️ Info o", "🖥️ Инфо о"],
      ["🖱 Lewy (LPM)", "🖱 Левая (ЛКМ)"],
      ["🖱 Prawy (PPM)", "🖱 Правая (ПКМ)"],
      ["🖱️ Klik", "🖱️ Клик"],
      ["🖼 Obraz", "🖼 Изображение"],
      ["🗣️ Formant", "🗣️ Форманта"],
      ["🗿 Gigant", "🗿 Гигант"],
      ["😈 Szatan", "😈 Сатана"],
      ["🚀 Kosmos", "🚀 Космос"],
      ["🚀 Netlify / Hosting", "🚀 Netlify / Хостинг"],
      ["🚀 Hosting / CDN", "🚀 Хостинг / CDN"],
      ["🟡 Gumowy", "🟡 Резиновый"],
      ["🟢 Noktowizor", "🟢 Ночное видение"],
      ["🟫 Sepia", "🟫 Сепия"],
      ["🤫 Cichy", "🤫 Тихий"],
      ["🤫 Szept", "🤫 Шёпот"],
      ["🦇 Jaskinia", "🦇 Пещера"],
      ["🧩 Mozaika", "🧩 Мозаика"],
      ["🧮 TEST MULTI-CORE (Web Workers)", "🧮 ТЕСТ MULTI-CORE (Web Workers)"],
      ["🪙 Moneta", "🪙 Монета"],
      ["🪞 Lustro", "🪞 Зеркало"],
      ["🪵 Drewno", "🪵 Дерево"],
      ["🎧 Podcast", "🎧 Подкаст"],
      ["🎙️ Normal", "🎙️ Обычный"],
      ["☁️ Praca zdalna", "☁️ Удалённая работа"],
      ["⚡ Dist.", "⚡ Дисторшн"],
      ["⏳ Wykrywanie...", "⏳ Определение..."],
      ["⏹ Stop", "⏹ Стоп"],
      ["🏗️ GENERATOR", "🏗️ ГЕНЕРАТОР"],
      ["🎯 Dart", "🎯 Дартс"],
      ["np. api.example.com", "напр. api.example.com"],
      ["np. cdn.example.com", "напр. cdn.example.com"],
      ["np. fonts.cdn.com", "напр. fonts.cdn.com"],
      ["np. google.com, github.com, 8.8.8.8", "напр. google.com, github.com, 8.8.8.8"],
      ["np. https://cdn.jsdelivr.net", "напр. https://cdn.jsdelivr.net"],
      ["np. images.cdn.com", "напр. images.cdn.com"],
      ["https://twoja-strona.netlify.app", "https://твой-сайт.netlify.app"],
      ["Windows) /", "Windows) /"],
      ["Punkty dotyku:", "Точки касания:"],
      ["StudioTest v7.8", "StudioTest v7.8"],
      // — ogólne (na końcu, jako fallback) —
      ['Kamera', 'Камера'], ['Mikrofon', 'Микрофон'], ['Brak', 'Нет'],
      [/(^|[^A-Za-z])Test FPS/g, '$1Тест FPS'],
      [/(^|[^A-Za-zА-Яа-я])Test(?=$|\s)/g, '$1Тест'],
      ['Kto stworzył?', 'Кто создал?'], ['Test netu', 'Тест сети'], ['Test reakcji', 'Тест реакции'], ['Test myszy', 'Тест мыши'],
      ['Głośniki', 'Колонки'], ['Wydajność', 'Производительность'], ['Żart', 'Шутка'], ['Kim jesteś?', 'Кто ты?'],
      ['Prywatność', 'Конфиденциальность'], ['Języki', 'Языки'],
    ],
  };

  const RT_WORDS = {
    ru: [
      ["limit", "лимит"],
      ["MB", "МБ"],
      ["KOLOR", "ЦВЕТ"],
      ["Kolor", "Цвет"],
      ["Kontrast", "Контраст"],
      ["Nasycenie", "Насыщенность"],
      ["Rozmycie", "Размытие"],
      ["Czarny", "Чёрный"],
      ["Czerwony", "Красный"],
      ["Zielony", "Зелёный"],
      ["Niebieski", "Синий"],
      ["Fioletowy", "Фиолетовый"],
      ["Granatowy", "Тёмно-синий"],
      ["Limonkowy", "Лаймовый"],
      ["Szmaragdowy", "Изумрудный"],
      ["Turkus", "Бирюзовый"],
      ["Bursztynowy", "Янтарный"],
      ["Szary", "Серый"],
      ["Kwadrat", "Квадрат"],
      ["AKTUALNY", "ТЕКУЩИЙ"],
      ["BATERIA", "БАТАРЕЯ"],
      ["CZAS", "ВРЕМЯ"],
      ["Cicho", "Тихо"],
      ["Cisza", "Тишина"],
      ["GOTOWE", "ГОТОВО"],
      ["HISTORIA", "ИСТОРИЯ"],
      ["KRAJ", "СТРАНА"],
      ["MIASTO", "ГОРОД"],
      ["Klawiatury", "Клавиатуры"],
      ["MAKSIMUM", "МАКСИМУМ"],
      ["MINIMUM", "МИНИМУМ"],
      ["MODYFIKATORY", "МОДИФИКАТОРЫ"],
      ["Myszy", "Мыши"],
      ["NAGRYWANIE", "ЗАПИСЬ"],
      ["OCENA", "ОЦЕНКА"],
      ["POKRYCIE", "ПОКРЫТИЕ"],
      ["POWIETRZE", "ВОЗДУХ"],
      ["Powietrze", "Воздух"],
      ["POZIOM", "УРОВЕНЬ"],
      ["PRZETESTOWANE", "ПРОТЕСТИРОВАНО"],
      ["Platforma", "Платформа"],
      ["Pobieranie", "Загрузка"],
      ["RDZENIE", "ЯДРА"],
      ["Rozlanie", "Растекание"],
      ["SKALOWANIE", "МАСШТАБИРОВАНИЕ"],
      ["SZCZYT", "ПИК"],
      ["Szczyt", "Пик"],
      ["Telefon", "Телефон"],
      ["Teraz", "Сейчас"],
      ["teraz", "сейчас"],
      ["Tolerancja", "Допуск"],
      ["WYNIK", "РЕЗУЛЬТАТ"],
      ["ZASOBY", "РЕСУРСЫ"],
      ["systemie", "системе"],
      ["unikalne", "уникальные"],
      ["klawiszy", "клавиш"],
      ["Reset", "Сброс"],
      ["RESET", "СБРОС"],
      ["ZAKRES", "ДИАПАЗОН"],
      ["Normalny", "Обычный"],
      ["Normal", "Обычный"],
      ["Lustro", "Зеркало"],
      ["Kopiuj", "Копировать"],
      ["Pinnij", "Закрепить"],
      ["Szept", "Шёпот"],
      ["Jaskinia", "Пещера"],
      ["Negatyw", "Негатив"],
      ["Ostry", "Резкий"],
      ["Robot", "Робот"],
      ["Sinus", "Синус"],
      ["Sopran", "Сопрано"],
      ["Flat", "Ровный"],
      ["Menu", "Меню"],
      ["Studio", "Студия"],
      ["Ping", "Пинг"],
      ["Publiczny", "Публичный"],
      ["Proxy:", "Прокси:"],
      ["Space", "Пробел"],
      ["Kraj", "Страна"],
      ["Cyan", "Циан"],
      ["Magenta", "Маджента"],
      ["Walkie", "Рация"],
      ["Dziecko", "Ребёнок"],
      ["Alien", "Инопланетянин"],
      ["Kosmita", "Инопланетянин"],
      ["Kropla", "Капля"],
      ["Deszcz", "Дождь"],
      ["Mysz", "Мышь"],
      ["Dramat", "Драма"],
      ["Moneta", "Монета"],
      ["Drewno", "Дерево"],
      ["Mozaika", "Мозаика"],
      ["Tunel", "Туннель"],
      ["Podcast", "Подкаст"],
      ["Komiks", "Комикс"],
      ["Stadion", "Стадион"],
      ["Gitara", "Гитара"],
      ["Harfa", "Арфа"],
      ["Flet", "Флейта"],
      ["Ksylofon", "Ксилофон"],
      ["Dzwonek", "Звонок"],
      ["Megafon", "Мегафон"],
      ["Telegraf", "Телеграф"],
      ["Maszyna", "Машинка"],
      ["Laser", "Лазер"],
      ["Metal", "Металл"],
      ["Radio", "Радио"],
      ["Sepia", "Сепия"],
      ["Matte", "Матовый"],
      ["Duch", "Призрак"],
      ["Staruszek", "Старик"],
      ["Szatan", "Сатана"],
      ["Gigant", "Гигант"],
      ["Kosmos", "Космос"],
      ["Inwers", "Инверсия"],
      ["Rastr", "Растр"],
      ["Scroll", "Прокрутка"],
      ["Klik", "Клик"],
      ["Obraz", "Изображение"],
      ["Formant", "Форманта"],
      ["Cichy", "Тихий"],
      ["Gumowy", "Резиновый"],
      ["Pijany", "Пьяный"],
      ["Konfetti", "Конфетти"],
      ["Olej", "Масло"],
      ["Sala", "Зал"],
      ["Grota", "Грот"],
      ["Woda", "Вода"],
      ["Syrena", "Сирена"],
      ["Podwodny", "Под водой"],
      ["Termowizor", "Тепловизор"],
      ["Termiczny", "Тепловой"],
      ["Termo", "Термо"],
      ["Szkic", "Эскиз"],
      ["Gwiazdy", "Звёзды"],
      ["Jasny", "Яркий"],
      ["Zimny", "Холодный"],
      ["Serduszka", "Сердечки"],
      ["Wibrafon", "Вибрафон"],
      ["Kalejdoskop", "Калейдоскоп"],
      ["Dziennik", "Журнал"],
      ["Lokalizacja", "Локация"],
      ["Skanlinie", "Строки развёртки"],
      ["Bramka", "Гейт"],
      ["DYREKTYWY", "ДИРЕКТИВЫ"],
      ["SKANER", "СКАНЕР"],
      ["SZUKAJ", "ПОИСК"],
      ["ANALIZA", "АНАЛИЗ"],
      ["RAPORT", "ОТЧЁТ"],
      ["EKRAN", "ЭКРАН"],
      ["OBRAZ", "ИЗОБРАЖЕНИЕ"],
      ["SYSTEM", "СИСТЕМА"],
      ["GENERATOR", "ГЕНЕРАТОР"],
      ["PERCENTYLE", "ПЕРЦЕНТИЛИ"],
      ["Monitor", "Монитор"],
      ["Laptop", "Ноутбук"],
      ["Info", "Инфо"],
      ["Dart", "Дартс"],
      ["Wykryto", "Обнаружено"],
      ["zatrzymany", "остановлен"],
      ["Stop", "Стоп"],
      ["START", "СТАРТ"],
      ["Start", "Старт"],
      ["Boczny", "Боковая"],
      ["Lewy", "Левый"],
      ["Prawy", "Правый"],
      ["np.", "напр."],
      ["wszystkie", "все"],
      ["Hosting", "Хостинг"]
    ],
  };

  const POL = /[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]|\b(Test|Brak|Kamera|Mikrofon|Nagraj|Zrób|Włącz|Wyłącz|Ustawienia|Skanuj|Wyczyść|Pętla|Biały|Żółty|Kanały|Urządzenie|Próbkowanie|Opóźnienie|Połączenie|Dostępn\w+|Użyto|Języki?|Niedostępne|Panel|Głośniki|Wydajność|Prywatność|Żart|Przeglądarka)\b/;
  const SKIP_TAGS = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, INPUT: 1, CODE: 1, PRE: 1 };
  const SKIP_TEXT = /^\s*(studio\s*test|studiotest|v7\.8.*)\s*$/i;

  const origText = new WeakMap();           // węzeł tekstowy -> oryginał PL
  const origAttr = new WeakMap();           // element -> {attr: oryginał}
  const ATTRS = ['title', 'placeholder', 'aria-label'];
  let lang = 'pl';
  let rules = [];
  let busy = false;

  function prepare(l) {
    const r = (RT_RULES[l] || []).slice();
    const strs = r.filter(x => typeof x[0] === 'string').sort((a, b) => b[0].length - a[0].length);
    const regs = r.filter(x => typeof x[0] !== 'string');
    // najpierw długie frazy, potem regexy (zawierają kotwice/fallbacki)
    const B = 'A-Za-z0-9_\\u00C0-\\u017F\\u0400-\\u04FF';
    const esc = x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const wregs = (RT_WORDS[l] || []).slice().sort((a, b) => b[0].length - a[0].length)
      .map(([pl, ru]) => [new RegExp('(^|[^' + B + '])' + esc(pl) + '(?![' + B + '])', 'g'), '$1' + ru.replace(/\$/g, '$$$$'), pl]);
    wordSrc = wregs.map(x => x[2]);
    rules = strs.concat(regs, wregs.map(x => [x[0], x[1]]));
    buildGate();
  }

  function buildGate() {
    const words = new Set();
    rules.forEach(([p]) => {
      const src = typeof p === 'string' ? p : '';
      (src.match(/[A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż]{3,}/g) || []).forEach(w => { if (!/[А-Яа-яЁё]/.test(w)) words.add(w); });
    });
    wordSrc.forEach(w => { if (/[A-Za-zĄĆĘŁŃÓŚŹŻąćęłńóśźż]{3,}/.test(w)) words.add(w); });
    const list = Array.from(words).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    gate = new RegExp('[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]|(' + list.join('|') + ')');
  }
  let gate = POL;
  let wordSrc = [];

  function tr(text) {
    if (!text || SKIP_TEXT.test(text) || !gate.test(text)) return text;
    const m = text.match(/^(\s*)([\s\S]*?)(\s*)$/);
    let out = m[2];
    for (const [p, rep] of rules) {
      out = typeof p === 'string' ? out.split(p).join(rep) : out.replace(p, rep);
    }
    return m[1] + out + m[3];
  }

  function doTextNode(n) {
    const p = n.parentElement;
    if (!p || SKIP_TAGS[p.tagName]) return;
    const cur = n.nodeValue;
    if (lang === 'pl') { if (origText.has(n)) { n.nodeValue = origText.get(n); origText.delete(n); } return; }
    if (!cur || !cur.trim()) return;
    const known = origText.get(n);
    if (known !== undefined && cur === tr(known)) return;   // już przetłumaczony
    const out = tr(cur);
    if (out !== cur) { origText.set(n, cur); n.nodeValue = out; }
  }

  function doAttrs(el) {
    if (!el.getAttribute) return;
    for (const a of ATTRS) {
      const v = el.getAttribute(a);
      if (v === null) continue;
      let store = origAttr.get(el);
      if (lang === 'pl') {
        if (store && store[a] !== undefined) { el.setAttribute(a, store[a]); delete store[a]; }
        continue;
      }
      if (el.hasAttribute('data-i18n-ph') && a === 'placeholder') continue;
      const out = tr(v);
      if (out !== v) {
        if (!store) { store = {}; origAttr.set(el, store); }
        if (store[a] === undefined) store[a] = v;
        el.setAttribute(a, out);
      }
    }
  }

  function walk(root) {
    busy = true;
    try {
      const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let n; const list = [];
      while ((n = w.nextNode())) list.push(n);
      list.forEach(doTextNode);
      if (root.nodeType === 1) { doAttrs(root); root.querySelectorAll('[title],[placeholder],[aria-label]').forEach(doAttrs); }
    } finally { busy = false; }
  }

  const mo = new MutationObserver(muts => {
    if (busy || lang === 'pl') return;
    busy = true;
    try {
      for (const m of muts) {
        if (m.type === 'characterData') doTextNode(m.target);
        else if (m.type === 'attributes') doAttrs(m.target);
        else m.addedNodes.forEach(nd => {
          if (nd.nodeType === 3) doTextNode(nd);
          else if (nd.nodeType === 1) { const w = document.createTreeWalker(nd, NodeFilter.SHOW_TEXT); let x; while ((x = w.nextNode())) doTextNode(x); doAttrs(nd); nd.querySelectorAll && nd.querySelectorAll('[title],[placeholder],[aria-label]').forEach(doAttrs); }
        });
      }
    } finally { busy = false; }
  });

  function apply(l) {
    lang = RT_RULES[l] ? l : 'pl';
    prepare(lang);
    if (lang === 'pl') {
      // przywróć oryginały (tylko gdy wcześniej tłumaczono)
      walk(document.body);
    } else {
      walk(document.body);
    }
  }

  function syncBotLang(l) {
    const sel = document.getElementById('aiBotTtsLang');
    if (!sel) return;
    const code = l === 'ua' ? 'uk' : l;
    const opt = Array.from(sel.options).find(o => o.value.toLowerCase().startsWith(code + '-'));
    if (opt && sel.value !== opt.value) { sel.value = opt.value; sel.dispatchEvent(new Event('change')); }
  }

  function init() {
    mo.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
    const origSetLang = window.setLang;
    if (typeof origSetLang === 'function') {
      window.setLang = function (l) {
        // przywróć PL przed przełączeniem (żeby data-i18n/t() pracowały na czystym stanie)
        lang = 'pl'; walk(document.body);
        const res = origSetLang.apply(this, arguments);
        try { syncBotLang(l); if (typeof aiBotRenderQuick === 'function') aiBotRenderQuick(); } catch (e) {}
        document.documentElement.lang = (l === 'ua' ? 'uk' : l);
        apply(l);
        return res;
      };
    }
    const cur = (typeof currentLang !== 'undefined') ? currentLang : 'pl';
    apply(cur);
    // po ekranie ładowania script.js woła setLang(currentLang) -> nasz wrapper zadziała
  }

  window.RT = { apply, tr, rules: RT_RULES };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
