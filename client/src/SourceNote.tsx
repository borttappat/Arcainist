/** The source offer the AGPL requires of a public server, and the fan-project notice. */
export function SourceNote() {
  return (
    <p className="muted source-note">
      Unofficial fan project, not affiliated with the owners of The Spoils.{" "}
      <a href={__SOURCE_URL__} target="_blank" rel="noreferrer">
        Source code
      </a>{" "}
      (AGPL-3.0).
    </p>
  );
}
