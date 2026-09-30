import { ArrowDown, ArrowUpRight, GraduationCap } from "lucide-react";
import React from "react";
import "./seasonFinale.css";

export function SeasonFinale(): React.ReactElement {
  return (
    <div className="season-finale">
      <a className="finale-skip-link" href="#letter">跳到收官信</a>
      <header className="finale-hero">
        <img
          alt="蓝天下的复旦大学光华楼与校园草坪"
          className="finale-campus"
          fetchPriority="high"
          height={1200}
          src="/assets/season-campus.jpg"
          width={1600}
        />
        <div className="finale-photo-shade" aria-hidden="true" />
        <nav className="finale-nav" aria-label="收官页导航">
          <a className="finale-brand" href="/celebration" aria-label="保研进度台收官页">
            <GraduationCap aria-hidden="true" size={28} strokeWidth={1.6} />
            <span>保研进度台</span>
          </a>
          <a className="finale-nav-link" href="#next-season">
            下一届见 <ArrowUpRight aria-hidden="true" size={16} />
          </a>
        </nav>

        <div className="finale-hero-content">
          <p className="finale-season">2026 保研季 <span aria-hidden="true">/</span> 圆满收官</p>
          <h1>保研进度台</h1>
          <p className="finale-congratulations">
            <span>保研已经结束啦，</span><span>祝贺大家圆满完成任务。</span>
          </p>
          <p className="finale-hero-note">那些追着截止时间奔跑的日子，可以先告一段落了。</p>
        </div>

        <div className="finale-hero-bottom">
          <span>本季 DDL 整理已结束</span>
          <a className="finale-read-link" href="#letter" aria-label="阅读收官信" title="阅读收官信">
            <span>一封收官信</span><ArrowDown aria-hidden="true" size={20} />
          </a>
        </div>
      </header>

      <main id="main-content">
        <section className="finale-letter" id="letter" aria-labelledby="letter-title">
          <div className="finale-letter-heading">
            <p className="finale-section-label">写给这一届的你</p>
            <h2 id="letter-title">到站了，歇一歇。</h2>
          </div>
          <div className="finale-letter-body">
            <p>
              从夏令营到预推免，查通知、改材料、等结果，这一路并不轻松。
              谢谢大家愿意使用这个小小的系统，让它陪着走过这段路。
              我们做的，只是把散落的时间点收拢在一起；真正一项项完成任务的人，是你们自己。
            </p>
            <p>
              现在，可以先把 DDL 从脑子里放下来了。好好吃顿饭，睡个整觉，
              做点一直想做、却没空做的事。接下来还有新的学习和生活，
              不必急着赶路，休息好了再慢慢出发。
            </p>
            <div className="finale-sign-off">
              <span className="finale-stamp" aria-label="辛苦啦">辛苦啦</span>
              <p>谢谢大家一路的信任。<span>保研进度台</span></p>
            </div>
          </div>
        </section>

        <section className="finale-next-season" id="next-season" aria-labelledby="next-season-title">
          <div className="finale-next-inner">
            <p className="finale-section-label">留给下一届的一句话</p>
            <h2 id="next-season-title">这一季收官，<br />这份心意留着。</h2>
            <p className="finale-wish">
              也许我们下一次保研的时候，我们还会开启我们的系统，给下一届同学做 DDL 的整理。
            </p>
            <p className="finale-next-note">愿这次攒下的经验，能让后来的人少一点手忙脚乱。</p>
          </div>
        </section>
      </main>

      <footer className="finale-footer">
        <p>保研进度台 <span>2026 · 本季收官</span></p>
        <a href="https://commons.wikimedia.org/wiki/File:Fudan-guanghualou2.jpg" rel="noreferrer" target="_blank">校园照片：复旦大学光华楼</a>
      </footer>
    </div>
  );
}
