import { SITES } from "./route.js";

const TILES = [
  { url: SITES.vitality, name: "Vitality Logistics", note: "The target's company website", tone: "vitality" },
  { url: SITES.worknet, name: "WorkNet", note: "Who works where, and for whom", tone: "worknet" },
  { url: SITES.pixa, name: "Pixa", note: "Photos people share in public", tone: "pixa" },
];

export default function StartPage({ go }) {
  return (
    <div className="start-page">
      <h3>Where do you want to look?</h3>
      <div className="start-tiles">
        {TILES.map((tile) => (
          <button key={tile.url} type="button" className={`start-tile is-${tile.tone}`} onClick={() => go(tile.url)}>
            <span className="start-tile-name">{tile.name}</span>
            <span className="start-tile-note">{tile.note}</span>
            <span className="start-tile-url">{tile.url}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
