import { NavLink } from "react-router-dom";
import FeedbackIcon from "../Feedback/FeedbackIcon";
import { EXACT_ROUTES } from "../../utils/sidebarGroups";
import styles from "./Navbar.module.css";

// Seções da navegação lateral (desktop) e do menu mobile da área interna.
// Os títulos recolhíveis são botões; o grupo da página atual fica sempre aberto.
function NavSections({ sections, openGroups, activeGroup, onToggle, linkClass, onNavigate, variant = "sidebar", idPrefix = "" }) {
  const mobile = variant === "mobile";
  return sections.map((section) => {
    const open = openGroups[section.group];
    const contentId = `${idPrefix}${section.id}`;
    const isActiveGroup = section.group === activeGroup;
    return (
      <div
        key={section.group}
        className={mobile ? styles.mobileSection : styles.navSection}
        data-active-group={isActiveGroup || undefined}
      >
        {section.collapsible ? (
          <button
            type="button"
            className={mobile ? styles.mobileGroupToggle : styles.groupToggle}
            aria-expanded={open}
            aria-controls={contentId}
            aria-disabled={isActiveGroup || undefined}
            onClick={() => { if (!isActiveGroup) onToggle(section.group); }}
          >
            <span>{section.group}</span>
            {isActiveGroup && <span className={styles.srOnly}> (contém a página atual)</span>}
            <FeedbackIcon name="chevronRight" className={styles.chevron} />
          </button>
        ) : (
          <span className={mobile ? styles.mobileGroupLabel : styles.groupLabel}>{section.group}</span>
        )}
        <div
          id={contentId}
          className={styles.groupItems}
          data-open={open}
          inert={!open || undefined}
        >
          <div className={styles.groupItemsInner}>
            {section.links.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                end={EXACT_ROUTES.has(link.to)}
                className={linkClass}
                onClick={onNavigate}
              >
                {link.label}
              </NavLink>
            ))}
          </div>
        </div>
      </div>
    );
  });
}

export default NavSections;
