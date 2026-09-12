* {
  box-sizing: border-box;
}

.prediction-dashboard {
  min-height: 100vh;
  background:
    radial-gradient(
      circle at top right,
      rgba(0, 255, 170, 0.08),
      transparent 35%
    ),
    #070b10;
  color: #f4f7fa;
  padding: 20px;
  font-family:
    Inter,
    system-ui,
    -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    sans-serif;
}

/* HEADER */

.dashboard-header {
  max-width: 1450px;
  margin: 0 auto 22px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
}

.brand-line {
  display: flex;
  align-items: center;
  gap: 13px;
}

.brand-mark {
  width: 48px;
  height: 48px;
  border-radius: 14px;
  display: grid;
  place-items: center;
  font-weight: 900;
  letter-spacing: -1px;
  background: linear-gradient(
    135deg,
    #00e6a0,
    #00a879
  );
  color: #03100c;
  box-shadow:
    0 0 25px rgba(0, 230, 160, 0.18);
}

.brand-line h1 {
  margin: 0;
  font-size: 20px;
  font-weight: 800;
}

.brand-line p {
  margin: 3px 0 0;
  color: #77838f;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 1.8px;
}

.connection-status {
  border: 1px solid #29323b;
  background: #0d1319;
  padding: 9px 13px;
  border-radius: 999px;
  color: #84909b;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 1px;
}

.connection-status span {
  width: 7px;
  height: 7px;
  display: inline-block;
  border-radius: 50%;
  background: #68737d;
  margin-right: 7px;
}

.connection-status.online {
  color: #52e5b1;
  border-color: rgba(0, 230, 160, 0.25);
}

.connection-status.online span {
  background: #00e6a0;
  box-shadow: 0 0 10px #00e6a0;
}

/* MARKET SELECTOR */

.market-selector,
.current-market,
.prediction-card,
.analytics-panel {
  max-width: 1450px;
  margin-left: auto;
  margin-right: auto;
}

.market-selector {
  margin-bottom: 14px;
}

.section-heading {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 9px;
}

.section-heading span {
  color: #dbe3e9;
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 1.5px;
}

.section-heading small {
  color: #56616c;
  font-size: 8px;
  font-weight: 700;
  letter-spacing: 1px;
}

.market-buttons {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 8px;
}

.market-buttons button {
  border: 1px solid #1e2831;
  border-radius: 12px;
  background: #0c1218;
  color: #8d99a4;
  padding: 12px;
  cursor: pointer;
  text-align: left;
  transition: 0.2s ease;
}

.market-buttons button:hover {
  border-color: #40505d;
  transform: translateY(-1px);
}

.market-buttons button.selected {
  border-color: rgba(0, 230, 160, 0.6);
  background:
    linear-gradient(
      135deg,
      rgba(0, 230, 160, 0.12),
      rgba(0, 230, 160, 0.025)
    );
  color: #ffffff;
  box-shadow:
    0 0 20px rgba(0, 230, 160, 0.06);
}

.market-buttons strong {
  display: block;
  font-size: 11px;
}

.market-buttons span {
  display: block;
  margin-top: 4px;
  color: #586570;
  font-size: 9px;
}

/* ACTIVE MARKET */

.current-market {
  margin-bottom: 14px;
  padding: 16px;
  border: 1px solid #1d2730;
  border-radius: 15px;
  background: #0b1117;
  display: flex;
  align-items: center;
  gap: 35px;
}

.current-label {
  color: #5d6a75;
  font-size: 8px;
  font-weight: 900;
  letter-spacing: 1.5px;
}

.current-market h2 {
  margin: 4px 0 0;
  font-size: 18px;
}

.tick-display {
  margin-left: auto;
  text-align: right;
}

.tick-display + .tick-display {
  margin-left: 0;
}

.tick-display span {
  display: block;
  color: #5c6873;
  font-size: 8px;
  font-weight: 800;
  letter-spacing: 1px;
}

.tick-display strong {
  display: block;
  margin-top: 4px;
  font-size: 16px;
}

/* CARDS */

.prediction-grid {
  max-width: 1450px;
  margin: 0 auto;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}

.prediction-card {
  width: 100%;
  padding: 17px;
  border: 1px solid #202a33;
  border-radius: 16px;
  background:
    linear-gradient(
      160deg,
      #10171e 0%,
      #0a1016 100%
    );
  box-shadow:
    0 12px 35px rgba(0, 0, 0, 0.22);
}

.prediction-card-top {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
}

.market-title {
  font-size: 12px;
  font-weight: 900;
  letter-spacing: 0.8px;
}

.market-subtitle {
  margin-top: 4px;
  color: #5d6975;
  font-size: 8px;
  font-weight: 700;
  letter-spacing: 1px;
}

.live-pill {
  display: flex;
  align-items: center;
  border-radius: 999px;
  padding: 5px 8px;
  font-size: 7px;
  font-weight: 900;
  letter-spacing: 1px;
  background: #12191f;
  color: #6f7a84;
}

.live-pill span {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #56616b;
  margin-right: 5px;
}

.live-pill.live {
  color: #55e9b7;
}

.live-pill.live span {
  background: #00e6a0;
  box-shadow: 0 0 8px #00e6a0;
}

.prediction-main {
  margin-top: 18px;
  padding: 18px;
  border-radius: 12px;
  background: #080e13;
  text-align: center;
  border: 1px solid #182129;
}

.prediction-label {
  color: #56636e;
  font-size: 8px;
  font-weight: 900;
  letter-spacing: 1.5px;
}

.prediction-value {
  min-height: 58px;
  margin: 5px 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #00e6a0;
  font-size: 27px;
  font-weight: 950;
  letter-spacing: 0.5px;
  text-shadow: 0 0 18px rgba(0, 230, 160, 0.15);
}

.confidence-row {
  display: flex;
  justify-content: space-between;
  color: #65717c;
  font-size: 9px;
  font-weight: 700;
}

.confidence-row strong {
  color: #d8e1e7;
}

.confidence-bar {
  height: 4px;
  margin-top: 8px;
  background: #182129;
  border-radius: 10px;
  overflow: hidden;
}

.confidence-fill {
  height: 100%;
  border-radius: 10px;
  background: #00e6a0;
  transition: width 0.3s ease;
}

.digit-title {
  margin-top: 17px;
  margin-bottom: 8px;
  color: #56636e;
  font-size: 8px;
  font-weight: 900;
  letter-spacing: 1.3px;
}

.digits {
  display: flex;
  gap: 5px;
  overflow: hidden;
  min-height: 26px;
}

.digit {
  min-width: 24px;
  height: 24px;
  display: grid;
  place-items: center;
  border-radius: 6px;
  background: #141c23;
  color: #a4afb8;
  font-size: 10px;
  font-weight: 800;
}

.digit.latest {
  background: rgba(0, 230, 160, 0.13);
  color: #00e6a0;
  border: 1px solid rgba(0, 230, 160, 0.25);
}

.waiting {
  color: #4d5963;
  font-size: 9px;
}

.execution-window {
  margin-top: 17px;
  padding-top: 13px;
  border-top: 1px solid #1a232c;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.execution-window > div {
  display: flex;
  align-items: center;
  color: #697681;
  font-size: 7px;
  font-weight: 900;
  letter-spacing: 0.8px;
}

.execution-dot {
  width: 6px;
  height: 6px;
  margin-right: 6px;
  border-radius: 50%;
  background: #00e6a0;
  box-shadow: 0 0 8px #00e6a0;
}

.trade-button {
  border: 0;
  border-radius: 7px;
  padding: 8px 13px;
  background: #00e6a0;
  color: #04120d;
  font-size: 8px;
  font-weight: 950;
  cursor: pointer;
}

.trade-button:hover {
  filter: brightness(1.08);
}

.trade-button:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

/* STATISTICS */

.analytics-panel {
  margin-top: 14px;
  padding: 17px;
  border: 1px solid #202a33;
  border-radius: 16px;
  background: #0b1117;
}

.analytics-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.analytics-title span {
  color: #586570;
  font-size: 8px;
  font-weight: 900;
  letter-spacing: 1.5px;
}

.analytics-title h2 {
  margin: 4px 0 0;
  font-size: 15px;
}

.accuracy {
  text-align: right;
}

.accuracy strong {
  display: block;
  color: #00e6a0;
  font-size: 20px;
}

.accuracy span {
  color: #53606b;
  font-size: 7px;
}

.stats-grid {
  margin-top: 15px;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}

.stat {
  padding: 13px;
  border: 1px solid #18222a;
  border-radius: 10px;
  background: #080e13;
}

.stat span {
  display: block;
  color: #52606b;
  font-size: 7px;
  font-weight: 900;
  letter-spacing: 1px;
}

.stat strong {
  display: block;
  margin-top: 5px;
  font-size: 17px;
}

/* FOOTER */

.dashboard-footer {
  max-width: 1450px;
  margin: 15px auto 0;
  padding: 12px 2px;
  display: flex;
  justify-content: space-between;
  color: #46525c;
  font-size: 8px;
  font-weight: 800;
  letter-spacing: 0.8px;
}

.footer-live-dot {
  display: inline-block;
  width: 5px;
  height: 5px;
  margin-right: 5px;
  border-radius: 50%;
  background: #00e6a0;
}

/* MOBILE */

@media (max-width: 900px) {
  .prediction-grid {
    grid-template-columns: 1fr;
  }

  .market-buttons {
    grid-template-columns: repeat(2, 1fr);
  }

  .stats-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 600px) {
  .prediction-dashboard {
    padding: 11px;
  }

  .dashboard-header {
    align-items: flex-start;
  }

  .brand-line h1 {
    font-size: 17px;
  }

  .connection-status {
    font-size: 8px;
    padding: 7px 9px;
  }

  .market-buttons {
    grid-template-columns: repeat(2, 1fr);
  }

  .market-buttons button {
    padding: 10px;
  }

  .current-market {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }

  .tick-display {
    margin-left: 0;
    text-align: left;
  }

  .prediction-card {
    padding: 14px;
  }

  .prediction-value {
    font-size: 23px;
  }

  .digits {
    gap: 4px;
  }

  .digit {
    min-width: 22px;
  }

  .dashboard-footer {
    flex-direction: column;
    gap: 8px;
  }
}
