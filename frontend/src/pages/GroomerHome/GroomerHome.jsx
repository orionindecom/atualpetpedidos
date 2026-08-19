import { Link } from "react-router-dom";
import Navbar from "../../components/Navbar/Navbar";
import styles from "./GroomerHome.module.css";

function GroomerHome() {
  return (
    <>
      <Navbar />
      <main className={styles.container}>
        <header className={styles.hero}>
          <span>Portal Groomer AtualPet</span>
          <h1>Conteúdo para apoiar sua rotina profissional.</h1>
          <p>Acesse treinamentos e materiais selecionados para o seu perfil.</p>
        </header>
        <section className={styles.grid} aria-label="Áreas disponíveis">
          <article>
            <span>Aprendizado</span>
            <h2>Treinamentos</h2>
            <p>Assista aos conteúdos disponíveis e acompanhe seu progresso.</p>
            <Link to="/treinamentos">Ver treinamentos</Link>
          </article>
          <article>
            <span>Divulgação</span>
            <h2>Materiais de marketing</h2>
            <p>Encontre campanhas, imagens e materiais liberados para Groomers.</p>
            <Link to="/materiais-marketing">Ver materiais</Link>
          </article>
        </section>
      </main>
    </>
  );
}

export default GroomerHome;
