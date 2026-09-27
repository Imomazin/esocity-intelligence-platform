import type { Competition, Team } from "@/lib/sports/types";

/**
 * Demo football universe.
 *
 * Clubs and competitions are FICTIONAL by design: the demo generates synthetic fixtures dated
 * relative to "today", and using real clubs would make synthetic probabilities look like
 * predictions for real matches. Licensed providers (Phase 2) replace this with real data.
 */

export interface DemoCompetitionDefinition {
  competition: Omit<Competition, "season" | "teamCount">;
  /** Kick-off slots per round: [dayOffset from Saturday, "HH:MM" UTC]. */
  kickoffSlots: [number, string][];
  teams: Omit<Team, "competitionKey">[];
}

export const DEMO_SPORT = { key: "football", name: "Football" } as const;

export const DEMO_COMPETITIONS: readonly DemoCompetitionDefinition[] = [
  {
    competition: {
      key: "premier-division",
      sportKey: "football",
      name: "Premier Division",
      shortName: "PD",
      region: "England (fictional)",
      baselineGoals: 1.38,
      homeAdvantage: 1.25,
    },
    kickoffSlots: [
      [0, "11:30"],
      [0, "14:00"],
      [0, "14:00"],
      [0, "14:00"],
      [0, "16:30"],
      [1, "13:00"],
    ],
    teams: [
      {
        key: "kingsbridge-city",
        name: "Kingsbridge City",
        shortName: "Kingsbridge",
        code: "KBC",
        city: "Kingsbridge",
        venue: "The Crown Ground",
      },
      {
        key: "ashworth-united",
        name: "Ashworth United",
        shortName: "Ashworth",
        code: "ASH",
        city: "Ashworth",
        venue: "Ashworth Lane",
      },
      {
        key: "northgate-rovers",
        name: "Northgate Rovers",
        shortName: "Northgate",
        code: "NGR",
        city: "Northgate",
        venue: "Rovers Park",
      },
      {
        key: "harbourside-fc",
        name: "Harbourside FC",
        shortName: "Harbourside",
        code: "HBS",
        city: "Harbourside",
        venue: "The Quayside Stadium",
      },
      {
        key: "redmarsh-athletic",
        name: "Redmarsh Athletic",
        shortName: "Redmarsh",
        code: "RMA",
        city: "Redmarsh",
        venue: "Marsh Road",
      },
      {
        key: "westford-albion",
        name: "Westford Albion",
        shortName: "Westford",
        code: "WFA",
        city: "Westford",
        venue: "Albion Park",
      },
      {
        key: "castlebrook-town",
        name: "Castlebrook Town",
        shortName: "Castlebrook",
        code: "CBT",
        city: "Castlebrook",
        venue: "The Keep",
      },
      {
        key: "elmstead-wanderers",
        name: "Elmstead Wanderers",
        shortName: "Elmstead",
        code: "ELW",
        city: "Elmstead",
        venue: "Elm Park",
      },
      {
        key: "stonehaven-county",
        name: "Stonehaven County",
        shortName: "Stonehaven",
        code: "STH",
        city: "Stonehaven",
        venue: "County Ground",
      },
      {
        key: "blackwater-forest",
        name: "Blackwater Forest",
        shortName: "Blackwater",
        code: "BWF",
        city: "Blackwater",
        venue: "Forest Lane",
      },
      {
        key: "millbrook-rangers",
        name: "Millbrook Rangers",
        shortName: "Millbrook",
        code: "MBR",
        city: "Millbrook",
        venue: "Millbrook Arena",
      },
      {
        key: "queensport-villa",
        name: "Queensport Villa",
        shortName: "Queensport",
        code: "QPV",
        city: "Queensport",
        venue: "Villa Stadium",
      },
    ],
  },
  {
    competition: {
      key: "continental-league",
      sportKey: "football",
      name: "Continental League",
      shortName: "CL",
      region: "Europe (fictional)",
      baselineGoals: 1.42,
      homeAdvantage: 1.3,
    },
    kickoffSlots: [
      [0, "13:00"],
      [0, "15:15"],
      [0, "17:30"],
      [1, "12:00"],
      [1, "17:45"],
    ],
    teams: [
      {
        key: "real-valdoria",
        name: "Real Valdoria",
        shortName: "Valdoria",
        code: "RVD",
        city: "Valdoria",
        venue: "Estadio del Valle",
      },
      {
        key: "atletico-serrano",
        name: "Atlético Serrano",
        shortName: "Serrano",
        code: "ATS",
        city: "Serrano",
        venue: "Estadio Serrano",
      },
      {
        key: "sporting-lusano",
        name: "Sporting Lusano",
        shortName: "Lusano",
        code: "SPL",
        city: "Lusano",
        venue: "Estádio Lusano",
      },
      {
        key: "fc-rheinstadt",
        name: "FC Rheinstadt",
        shortName: "Rheinstadt",
        code: "FCR",
        city: "Rheinstadt",
        venue: "Rheinpark Arena",
      },
      {
        key: "olympique-marenne",
        name: "Olympique Marenne",
        shortName: "Marenne",
        code: "OLM",
        city: "Marenne",
        venue: "Stade de la Marenne",
      },
      {
        key: "ac-varenza",
        name: "AC Varenza",
        shortName: "Varenza",
        code: "ACV",
        city: "Varenza",
        venue: "Stadio Varenza",
      },
      {
        key: "dinamo-kovar",
        name: "Dinamo Kovar",
        shortName: "Kovar",
        code: "DNK",
        city: "Kovar",
        venue: "Kovar City Stadium",
      },
      {
        key: "sc-nordhaven",
        name: "SC Nordhaven",
        shortName: "Nordhaven",
        code: "SCN",
        city: "Nordhaven",
        venue: "Nordhaven Arena",
      },
      {
        key: "uniao-portalba",
        name: "União Portalba",
        shortName: "Portalba",
        code: "UPT",
        city: "Portalba",
        venue: "Estádio Portalba",
      },
      {
        key: "racing-aurelia",
        name: "Racing Aurelia",
        shortName: "Aurelia",
        code: "RAC",
        city: "Aurelia",
        venue: "Stade Aurelia",
      },
    ],
  },
];
