# clawd-fm

[Claude FM](https://www.youtube.com/@claude/live), the lofi radio for thinking and building, playing right inside Claude Code. A band above the prompt shows Clawd in small animated scenes, the current track, and volume controls.

- **Live stream** through `mpv`, with a buffer and automatic reconnects.
- **Now playing**: the track name is read off the stream's own "now playing" plate and shown in the corner, the way the stream shows it.
- **Scenes while you listen** follow the time of day and change in turn with each track. Daytime has a meadow, a cozy room with rain on the window, rain outside, a train ride, a pier and snow. Evening and night have stars, the cozy room, a city, fireflies, a campfire, a lighthouse and a rocket ride through space.
- **Scenes while Claude works** follow what it is doing. Bash shows a terminal with the command typed out. Read and Grep show a page under a magnifier. Edit and Write show Clawd building a wall. WebSearch and WebFetch show Clawd beaming signals to a planet. Agent shows a line of tiny helpers. When nothing else applies, Clawd is thinking.
- **Reactions**: Clawd jumps when a turn finishes and sweats when a tool fails.
- **Track list**: every track heard is saved, and `/fm list` prints them with Spotify search links.

Terminal only for now: the scenes use Claude Code's pixel `Raster` element, which the desktop app does not draw.

## Requirements

- Claude Code with plugin function hooks (early access API, tested on 2.1.299)
- `mpv`, `yt-dlp`, `ffmpeg`, `tesseract` (with English data), `python3`

On Arch / CachyOS:

```sh
sudo pacman -S mpv yt-dlp ffmpeg tesseract tesseract-data-eng python
```

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install clawd-fm --marketplace Advnirr/clawd-fm
```

Answer `y` to add the marketplace, then pick a scope.

From a shell:

```sh
claude plugin install clawd-fm --marketplace Advnirr/clawd-fm
```

The repository is private for now. Installing needs read access on GitHub and a git credential for github.com on your machine, for example `gh auth login` followed by `gh auth setup-git`.

### YouTube sign-in

YouTube often answers yt-dlp with "Sign in to confirm you're not a bot". If that happens, let yt-dlp borrow your browser's YouTube cookies. In `/config`, set **clawd-fm → Cookies from browser** to one of:

- `firefox`, `chrome`, `brave`, and so on, for the browser's default profile
- `firefox:/path/to/profile` for one exact profile. Firefox forks such as Zen keep their profiles in their own folders, for example `~/.config/zen/xxxx.default-release`.

The cookies are only passed to yt-dlp on your machine.

## Use

| | |
|---|---|
| `/fm` | show the band and start the radio; run it again to stop and hide |
| `/fm stop` | stop the sound and keep the band |
| `/fm +`, `/fm -`, `/fm vol 70` | volume |
| `/fm scene` | next scene |
| `/fm list` | every track heard so far, with Spotify search links |

Keys: press `ctrl+x`, then `tab`, to focus the band. Then `p` plays or stops, `j` and `k` change the volume, `s` changes the scene, and `Esc` returns to the prompt. `[-]` at the band's right edge collapses it.

## How it works

`mpv` plays the stream and, through a video filter, saves the "now playing" plate twice a second as a small image. `bin/collect.py` reads those images with `tesseract` and stitches the scrolling text back into `Artist — Title`. It takes the version it read most often, and fixes common OCR slips like `Tour1st` against a word list. That way there is only one connection to YouTube.

The plugin keeps everything it learns in `~/.local/share/clawd-fm/tracks.json`. `bin/collect.py` also runs on its own and opens the stream itself:

```sh
python3 bin/collect.py --out tracks.json --cookies-from-browser firefox
```

## Credits

The music on Claude FM belongs to its artists. This plugin plays the official live stream and does not copy or redistribute any audio. If you like a track, look the artist up and support them.

Tracks heard on the stream so far, as the stream's own plate names them:

| Artist | Track |
|---|---|
| Ardley | Dawn Hour |
| Astor | Blue Houses (Ft. Nate Purscelley) |
| Astor | Evening in Spring (Ft. Farnell Newton) |
| Astor | Forest Park (Ft. Farnell Newton) |
| Astor | Midnight Tourist |
| Astor | Street Lights in the Fog |
| Cameron Smith | Every Goodbye Is a Chance for New Universes |
| Chad Crouch | Shipping Lanes |
| Cineone | Nature Guide |
| David Swensen | Second Sister |
| Fields of Ethera | Boundless Horizons C |
| Fields of Ethera | Breathe In (Lofi Edition) |
| Grapefruit | Cop Talk |
| Jaimie Pangan | Another Lofi Day |
| Jaybird Blonde | Subway Ride |
| Joey Kantor | Palmera |
| Joya | Oregold |
| Keen Collective | Beginnings |
| Kolby Wade | Pianos on Grand Street |
| Kyle Preston | We Made It. We Finally Made It |
| Memory Palace | Sweetgrass |
| Ol' Burger Beats | Ella G |
| Ol' Burger Beats | Winter Night |
| Peripheral Bliss | Between Dreams |
| Siren and the Sea | Instinct |
| Siren and the Sea | Organ Breath |
| Siren and the Sea | The Large Floating Vessel |
| Staggering Vistas | That's The Equipment |

The playlist changes over time, so this list is a snapshot. Run `/fm list` to see what your copy has heard.

Claude FM and Claude are Anthropic's. This is an independent fan project, not made by or affiliated with Anthropic.

## License

The plugin's code is under the [MIT License](LICENSE). The license covers the code only, not the music or the Claude FM stream.
