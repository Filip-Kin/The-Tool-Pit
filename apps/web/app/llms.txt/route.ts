/**
 * /llms.txt as a route, not a static file: this app builds with Next's
 * standalone output, which does not serve public/ files here (robots.txt and
 * sitemap.xml work because they are routes too). Plain text, cached a day.
 */
const BODY = `# FRC.Tools

> FRC.Tools is a community directory for FIRST robotics teams (FRC, FTC, FLL). It lists tools, calculators and apps, off-season events, practice fields, team robot code and CAD, event photo albums, and grants teams can apply for. Everything is free and open to submissions.

## Sections
- [Tools directory](https://frc.tools/): calculators, scouting apps, CAD and programming tools, searchable by program and need.
- [Off-season events](https://frc.tools/events): a map of off-season competitions with dates, cost, capacity and registration status.
- [Practice fields](https://frc.tools/fields): a map of practice fields teams can visit or book.
- [Robot code and CAD](https://frc.tools/robot-code): open-source team robot code and CAD, by team and season.
- [Event photos](https://frc.tools/photos): photo albums from FIRST events, by event and team.
- [Grants](https://frc.tools/grants): grants and sponsorships a team can apply for, with deadlines.

## Programs
- [FRC](https://frc.tools/frc) - FIRST Robotics Competition
- [FTC](https://frc.tools/ftc) - FIRST Tech Challenge
- [FLL](https://frc.tools/fll) - FIRST LEGO League
`

export function GET() {
  return new Response(BODY, {
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'public, max-age=86400' },
  })
}
