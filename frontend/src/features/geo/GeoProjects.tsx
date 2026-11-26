import { useState } from 'react';
import { ArrowRight, FolderOpen, Plus, Search } from 'lucide-react';
import { sections, type Project, type Section } from './model';

interface Props {
  projects: Project[];
  section: Section;
  open: (projectId: string) => void;
  add: () => void;
}

export default function GeoProjects({ projects, section, open, add }: Props) {
  const [search, setSearch] = useState('');
  const query = search.trim().toLocaleLowerCase();
  const filtered = projects.filter(project => `${project.name} ${project.brand}`.toLocaleLowerCase().includes(query));
  const target = sections.find(([key]) => key === section)?.[1];
  return (
    <section className="geo-projects" aria-labelledby="geo-project-list-heading">
      <div className="geo-section-head">
        <div>
          <h2 id="geo-project-list-heading">项目管理</h2>
          <p className="geo-muted">{projects.length} 个本地项目{target && section !== 'projects' ? ` · 选择项目进入${target}` : ''}</p>
        </div>
        <label className="geo-search">
          <Search size={16} />
          <input aria-label="搜索 GEO 项目" placeholder="搜索项目或品牌" value={search} onChange={event => setSearch(event.target.value)} />
        </label>
      </div>
      <div className="geo-project-list">
        {filtered.map(project => <article className="geo-project-row" key={project.id}>
          <FolderOpen size={23} aria-hidden="true" />
          <div className="geo-project-summary">
            <h3><button className="geo-link" onClick={() => open(project.id)}>{project.name}</button></h3>
            <p className="geo-muted">{project.brand} · 本地资料 · 外部观测未接入</p>
          </div>
          <dl className="geo-project-counts">
            <div><dt>目标问题</dt><dd>{project.questions.length}</dd></div>
            <div><dt>关联资料</dt><dd>{project.sources.length}</dd></div>
            <div><dt>待审内容</dt><dd>{project.drafts.filter(draft => draft.status === 'draft').length}</dd></div>
          </dl>
          <button
            className="geo-icon"
            title={`打开项目 ${project.name}`}
            aria-label={`打开项目 ${project.name}`}
            onClick={() => open(project.id)}
          ><ArrowRight size={18} /></button>
        </article>)}
      </div>
      {!filtered.length && <div className="geo-empty">
        <FolderOpen size={32} />
        <p>{projects.length ? '没有匹配的项目' : '还没有本地项目'}</p>
        {!projects.length && <button className="button" onClick={add}><Plus size={16} />创建第一个项目</button>}
      </div>}
    </section>
  );
}
