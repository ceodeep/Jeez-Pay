import { useState } from "react";
import {
  BellIcon,
  MenuIcon,
  SearchIcon,
} from "./ui/Bits";
import { CLASSIC_URL, MOBILE_TABS, NAV, PAGE_TITLES } from "./lib/nav";

function initials(label) {
  const parts = String(label || "A")
    .replace(/[^A-Za-z ]/g, " ")
    .trim()
    .split(/\s+/);
  return parts
    .slice(0, 2)
    .map((part) => part[0] || "")
    .join("")
    .toUpperCase();
}

export default function Shell({
  page,
  onNavigate,
  allowed,
  counts,
  admin,
  drawerOpen,
  onCloseDrawer,
  onSearch,
  children,
}) {
  const [menu, setMenu] = useState(false);
  const [query, setQuery] = useState("");

  const go = (key) => {
    setMenu(false);
    onNavigate(key);
  };

  const submitSearch = (event) => {
    event.preventDefault();
    const value = query.trim();
    if (!value) return;
    onSearch(value);
    setQuery("");
  };

  const badgeFor = (item) => {
    if (!item.badge) return null;
    const value = counts?.[item.badge];
    if (value == null || value === 0) return null;
    return value;
  };

  return (
    <div className="shell" data-drawer={drawerOpen ? "1" : "0"}>
      <aside className="rail" data-open={menu ? "1" : "0"}>
        <div className="rail__brand">
          <div className="rail__mark">J</div>
          <div>
            <span className="rail__name">JeezPay</span>
            <span className="rail__sub">Admin</span>
          </div>
        </div>

        <div className="rail__scope">
          <span>Production</span>
          <em>LIVE</em>
        </div>

        <div className="rail__groups">
          {NAV.map((group) => {
            const items = group.items.filter((item) => allowed.has(item.key));
            if (items.length === 0) return null;
            return (
              <div className="nav__group" key={group.label}>
                <div className="nav__label">{group.label}</div>
                {items.map((item) => {
                  const badge = badgeFor(item);
                  return (
                    <button
                      key={item.key}
                      type="button"
                      className="nav__item"
                      aria-current={page === item.key ? "page" : undefined}
                      onClick={() => go(item.key)}
                    >
                      {item.label}
                      {badge != null ? (
                        <span
                          className={`nav__count ${
                            item.key === "dashboard" ? "" : "nav__count--warn"
                          }`}
                        >
                          {badge > 99 ? "99+" : badge}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>

        <div className="rail__foot">
          <div className="rail__shift">
            Classic screens still live at <b>/classic</b>
          </div>
          <a className="nav__item" href={CLASSIC_URL}>
            Open classic admin
          </a>
          <div className="rail__me">
            <div className="avatar">{initials(admin?.phone || admin?.name)}</div>
            <em>{admin?.name || admin?.phone || "Admin"}</em>
            <span>{admin?.role || "admin"}</span>
          </div>
        </div>
      </aside>

      {menu ? (
        <button
          type="button"
          className="scrim"
          aria-label="Close menu"
          onClick={() => setMenu(false)}
        />
      ) : null}

      <div className="main">
        <header className="topbar">
          <button
            type="button"
            className="iconbtn menubtn"
            aria-label="Open menu"
            onClick={() => setMenu(true)}
          >
            <MenuIcon />
          </button>

          <div className="crumb">
            <span>Operations</span>
            <span>/</span>
            <b>{PAGE_TITLES[page] || "Today"}</b>
          </div>

          <form className="search" onSubmit={submitSearch}>
            <SearchIcon />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Find a user by phone or ID"
              aria-label="Find a user by phone or ID"
            />
            <span className="kbd">↵</span>
          </form>

          <div className="spacer" />
          <div className="envchip">
            <i className="dot" />
            LIVE
          </div>
          <button type="button" className="iconbtn" aria-label="Notifications" disabled>
            <BellIcon />
          </button>
        </header>

        {children}
      </div>

      {drawerOpen ? (
        <button
          type="button"
          className="drawer-scrim"
          aria-label="Close panel"
          onClick={onCloseDrawer}
        />
      ) : null}

      <nav className="mobnav" aria-label="Primary">
        {MOBILE_TABS.filter((key) => allowed.has(key)).map((key) => {
          const item = NAV.flatMap((group) => group.items).find((entry) => entry.key === key);
          const badge = badgeFor(item || {});
          return (
            <button
              key={key}
              type="button"
              aria-current={page === key ? "page" : undefined}
              onClick={() => go(key)}
            >
              {badge != null ? <span className="badge">{badge > 9 ? "9+" : badge}</span> : null}
              {PAGE_TITLES[key]?.split(" ")[0] || key}
            </button>
          );
        })}
        <button type="button" onClick={() => setMenu(true)}>
          More
        </button>
      </nav>
    </div>
  );
}
