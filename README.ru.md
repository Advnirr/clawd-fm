# clawd-fm

[English](README.md) · **Русский**

[Claude FM](https://www.youtube.com/@claude/live), лоуфай-радио для размышлений и работы, теперь играет прямо в Claude Code. Над строкой ввода появляется полоса: в ней Clawd в маленьких анимированных сценах, название текущего трека и регулятор громкости.

- **Прямой эфир** через `mpv`, с буфером и автоматическим переподключением.
- **Что сейчас играет**: название трека считывается с плашки «now playing» в самом эфире и показывается в углу, как в трансляции.
- **Сцены во время прослушивания** зависят от времени суток и времени года и меняются по очереди с каждым треком. Днём это луг, уютная комната с дождём за окном, дождь на улице, листопад, поезд, катание на коньках по замёрзшему пруду, пирс и снег. Вечером и ночью: звёздное небо, та же уютная комната, город, светлячки, костёр, маяк и полёт на ракете. С 10 декабря по 14 января каждая вторая сцена праздничная: ёлка с подарками, Clawd с санками подарков, а ночью салют.
- **Сцены, пока Claude работает**, показывают, чем он занят. Bash — терминал, где набирается команда. Read и Grep — страница под лупой. Edit и Write — Clawd строит стену. WebSearch и WebFetch — Clawd шлёт сигналы на планету. Agent — вереница маленьких помощников. Во всех остальных случаях Clawd думает.
- **Реакции**: Clawd подпрыгивает, когда ход закончен, и потеет, когда инструмент завершился ошибкой.
- **Список треков**: каждый услышанный трек сохраняется, а `/fm list` выводит их со ссылками на поиск в Spotify.

![clawd-fm в Claude Code](docs/demo.gif)

Пока только в терминале: сцены рисуются пиксельным элементом Claude Code `Raster`, а десктопное приложение его не отображает.

## Сцены

Уютная комната с дождём за окном. Она бывает и днём, и ночью; над строкой ввода видны полоса и её кнопки:

![Уютная комната](docs/room.png)

**День** (с 7:00 до 20:00): луг, дождь, листопад, поезд, пирс и снег.

![Луг](docs/meadow.png)
![Дождь](docs/rain.png)
![Поезд](docs/train.png)
![Пирс](docs/sea.png)
![Снег](docs/snow.png)

**Вечер и ночь**: город, светлячки, костёр, маяк, звёздная ночь и полёт на ракете.

![Город](docs/city.png)
![Светлячки](docs/fireflies.png)
![Костёр](docs/campfire.png)
![Маяк](docs/lighthouse.png)
![Ночь](docs/night.png)
![Космос](docs/space.png)

**Времена года** (для северного полушария): луг бывает весной и летом, листопад с сентября по ноябрь, снег и коньки с декабря по февраль, светлячки летними ночами, а дождь в любой месяц, кроме зимних. С 10 декабря по 14 января через сцену появляются ёлка, санки с подарками и салют. Сцены, которые идут круглый год, тоже меняются по сезону: зимой поезд едет мимо белых холмов, осенью мимо золотых, за окном уютной комнаты, над пирсом и у костра идёт снег, а весной на лугу распускаются цветы.

**Пока Claude работает**, сцена зависит от инструмента, а когда ход закончен, Clawd подпрыгивает:

![Готово](docs/happy.png)

## Что нужно

- Claude Code с функциональными хуками плагинов (API раннего доступа, проверено на 2.1.299)
- `mpv`, `yt-dlp`, `ffmpeg`, `tesseract` (с английскими данными), `python3`

В Arch / CachyOS:

```sh
sudo pacman -S mpv yt-dlp ffmpeg tesseract tesseract-data-eng python
```

## Установка

В строке ввода Claude Code в терминале:

```
/plugin install clawd-fm --marketplace Advnirr/clawd-fm
```

На вопрос о добавлении маркетплейса ответьте `y`, затем выберите область установки (scope).

Из командной строки:

```sh
claude plugin install clawd-fm --marketplace Advnirr/clawd-fm
```

### Вход в YouTube

YouTube часто отвечает yt-dlp «Sign in to confirm you're not a bot», и полоса об этом сообщает. В таком случае дайте yt-dlp cookies YouTube из вашего браузера. Выполните `/plugin configure clawd-fm@clawd-fm` и заполните **Cookies from browser** или передайте значение при установке из командной строки: `claude plugin install clawd-fm@clawd-fm --config cookiesFromBrowser=firefox`. Значение может быть таким:

- `firefox`, `chrome`, `brave` и так далее — профиль браузера по умолчанию;
- `firefox:/путь/к/профилю` — один конкретный профиль. Форки Firefox, например Zen, хранят профили в своих папках, например `~/.config/zen/xxxx.default-release`. Указывайте имя движка, `firefox`, а не форка: yt-dlp не знает `zen`, и полоса об этом скажет.

Cookies передаются только yt-dlp на вашем компьютере. Но они дают доступ к аккаунту YouTube, которому принадлежат, поэтому лучше завести отдельный профиль браузера, где выполнен вход только в YouTube.

## Использование

| | |
|---|---|
| `/fm` | показать полосу и включить радио; повторный вызов останавливает и скрывает |
| `/fm stop` | выключить звук, оставив полосу |
| `/fm +`, `/fm -`, `/fm vol 70` | громкость |
| `/fm scene` | следующая сцена |
| `/fm list` | все услышанные треки со ссылками на поиск в Spotify |

Клавиши: нажмите `ctrl+x`, затем `tab`, чтобы перейти в полосу. Там `p` включает и выключает звук, `j` и `k` меняют громкость, `s` переключает сцену, а `Esc` возвращает в строку ввода. `[-]` у правого края полосы сворачивает её.

Если `/fm` открыт в нескольких терминалах, эфир играет только в одном. Остальные показывают его трек с пометкой «playing in another terminal» и второй плеер не запускают. Остановка в любом терминале выключает радио во всех, громкость общая, а когда играющий терминал закрывается, эфир подхватывает один из ждущих.

## Ограничения

- Проверено на Linux (Arch / CachyOS). На macOS должно работать с теми же программами из Homebrew, но не проверялось. Windows не поддерживается.
- Только терминал: десктопное приложение не рисует пиксельные сцены.
- Функциональные хуки плагинов — API раннего доступа Claude Code. Плагин сделан на версиях 2.1.299 и 2.1.300, после обновлений Claude Code его может понадобиться поправить.
- Название трека считывается с того места, где эфир рисует свою плашку сейчас. Если Claude FM изменит оформление, координаты `CROP` в `bin/collect.py` и `PLATE_VF` в `hooks/register.tsx` придётся обновить.
- Воспроизведение YouTube через yt-dlp выходит за рамки условий использования YouTube. Так работают многие открытые плееры, но пользуйтесь этим, понимая это.

## Как это устроено

`mpv` проигрывает эфир и через видеофильтр дважды в секунду сохраняет плашку «now playing» маленькой картинкой. `bin/collect.py` распознаёт эти картинки с помощью `tesseract` и склеивает бегущую строку обратно в `Исполнитель — Трек`. Он берёт вариант, который распознался чаще всего, и исправляет типичные ошибки OCR вроде `Tour1st` по словарю. Так к YouTube идёт только одно подключение.

Всё, что плагин узнаёт, хранится в `~/.local/share/clawd-fm/tracks.json`. `bin/collect.py` работает и сам по себе, тогда он сам открывает эфир:

```sh
python3 bin/collect.py --out tracks.json --cookies-from-browser firefox
```

## Разработка

```sh
claude plugin validate .           # манифест и модуль хуков
claude plugin test .               # hooks/*.test.ts(x): сцены, /fm, полоса, аргументы mpv
python3 -m unittest discover -s tests   # bin/collect.py: исправления OCR, бегущая строка, список треков
uvx ruff check bin/ tests/ && uvx ruff format --check bin/
bandit -r bin/
```

Настройки ruff лежат в `pyproject.toml`. Вызовы `subprocess` в `bin/collect.py` помечены `nosec`: каждый передаёт список аргументов программе, найденной через `shutil.which`, и ни один не идёт через оболочку.

## Благодарности

Музыка Claude FM принадлежит её авторам. Плагин проигрывает официальный эфир и не копирует и не распространяет аудио. Если трек понравился, найдите исполнителя и поддержите его.

Треки, которые уже звучали в эфире, с названиями как на плашке эфира. Ссылка стоит только там, где каталог знает именно этот трек под этим именем; остальных исполнителей пока не удалось найти.

| Исполнитель | Трек | Где слушать |
|---|---|---|
| Ardley | Dawn Hour | [Apple Music](https://music.apple.com/us/artist/ardley/252329659) |
| Astor | Blue Houses (Ft. Nate Purscelley) | [Apple Music](https://music.apple.com/us/artist/astor/1580170691) |
| Astor | Evening in Spring (Ft. Farnell Newton) | [Apple Music](https://music.apple.com/us/artist/astor/1580170691) |
| Astor | Forest Park (Ft. Farnell Newton) | [Apple Music](https://music.apple.com/us/artist/astor/1580170691) |
| Astor | Midnight Tourist | [Apple Music](https://music.apple.com/us/artist/astor/1580170691) |
| Astor | Street Lights in the Fog | [Apple Music](https://music.apple.com/us/artist/astor/1580170691) |
| Cameron Smith | Every Goodbye Is a Chance for New Universes |  |
| Chad Crouch | Shipping Lanes | [Apple Music](https://music.apple.com/us/artist/chad-crouch/19053718) · [Deezer](https://www.deezer.com/artist/2342991) |
| Cineone | Nature Guide |  |
| David Swensen | Second Sister |  |
| Fields of Ethera | Boundless Horizons C | [Apple Music](https://music.apple.com/us/artist/fields-of-ethera/1779019601) |
| Fields of Ethera | Breathe In (Lofi Edition) | [Apple Music](https://music.apple.com/us/artist/fields-of-ethera/1779019601) |
| Graham Barton | Juntura |  |
| Grapefruit | Cop Talk |  |
| Jaimie Pangan | Another Lofi Day |  |
| Jaimie Pangan | Lofi Mechanical Heartbeat |  |
| Jaybird Blonde | Subway Ride |  |
| Joey Kantor | Palmera | [Apple Music](https://music.apple.com/us/artist/joey-kantor/1555719070) |
| Joya | Oregold | [Apple Music](https://music.apple.com/us/artist/joya/82430926) · [Deezer](https://www.deezer.com/artist/133212) |
| Keen Collective | Beginnings | [Apple Music](https://music.apple.com/us/artist/keen-collective/1532380082) |
| Kolby Wade | Pianos on Grand Street |  |
| Kyle Preston | We Made It. We Finally Made It | [Apple Music](https://music.apple.com/us/artist/kyle-preston/1055457630) · [Deezer](https://www.deezer.com/artist/10455373) |
| Memory Palace | Sweetgrass | [Apple Music](https://music.apple.com/us/artist/memory-palace/1579120302) |
| Ol' Burger Beats | Ella G | [Apple Music](https://music.apple.com/us/artist/ol-burger-beats/933212664) · [Deezer](https://www.deezer.com/artist/6930641) |
| Ol' Burger Beats | Winter Night | [Apple Music](https://music.apple.com/us/artist/ol-burger-beats/933212664) · [Deezer](https://www.deezer.com/artist/6930641) |
| Peripheral Bliss | Between Dreams | [Apple Music](https://music.apple.com/us/artist/peripheral-bliss/300367124) |
| Siren and the Sea | Instinct | [Apple Music](https://music.apple.com/us/artist/siren-and-the-sea/1180251702) · [Deezer](https://www.deezer.com/artist/11440890) · [Bandcamp](https://sirenandthesea.bandcamp.com) |
| Siren and the Sea | Organ Breath | [Apple Music](https://music.apple.com/us/artist/siren-and-the-sea/1180251702) · [Deezer](https://www.deezer.com/artist/11440890) · [Bandcamp](https://sirenandthesea.bandcamp.com) |
| Siren and the Sea | The Large Floating Vessel | [Apple Music](https://music.apple.com/us/artist/siren-and-the-sea/1180251702) · [Deezer](https://www.deezer.com/artist/11440890) · [Bandcamp](https://sirenandthesea.bandcamp.com) |
| Staggering Vistas | That's The Equipment |  |

Плейлист со временем меняется, так что это снимок на момент написания. `/fm list` покажет, что услышала ваша копия.

Claude FM и Claude принадлежат Anthropic. Это независимый фанатский проект, Anthropic его не делала и с ним не связана.

## Лицензия

Код плагина распространяется по [лицензии MIT](LICENSE). Лицензия распространяется только на код, но не на музыку и не на эфир Claude FM.
