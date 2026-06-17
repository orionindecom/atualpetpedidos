import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import api from "../../api/axios";
import styles from "./Cadastro.module.css";
import logo from "../../assets/logo-atualpet-white.png";

function Cadastro() {
  const navigate = useNavigate();

  const [form, setForm] = useState({
    nomeResponsavel: "",
    email: "",
    senha: "",
    razaoSocial: "",
    nomeFantasia: "",
    cnpj: "",
    telefone: "",
    whatsapp: "",
  });

  const alterar = (e) => {
    setForm({
      ...form,
      [e.target.name]: e.target.value,
    });
  };

  const cadastrar = async (e) => {
    e.preventDefault();

    try {
      await api.post("/auth/cadastro", form);

      alert("Cadastro enviado com sucesso. Aguarde aprovação.");
      navigate("/login");
    } catch (error) {
      alert(error.response?.data?.message || "Erro ao cadastrar");
    }
  };

  return (
    <div className={styles.page}>
      <section className={styles.info}>
        <div className={styles.brand}>
          <div className={styles.logo}>
                  <img src={logo} alt="AtualPet" />
                </div>
          <div>
            <h1>AtualPet</h1>
            <p>Solicitação de acesso</p>
          </div>
        </div>

        <div className={styles.texto}>
          <h2>Cadastre sua empresa para acessar o catálogo comercial.</h2>
          <p>
            Após o envio, a equipe AtualPet irá analisar seu cadastro,
            aprovar o acesso e vincular sua tabela de preços.
          </p>
        </div>

        <div className={styles.passos}>
          <span>1. Envie seus dados</span>
          <span>2. Aguarde aprovação</span>
          <span>3. Acesse sua tabela</span>
        </div>
      </section>

      <section className={styles.formArea}>
        <form className={styles.card} onSubmit={cadastrar}>
          <h2>Solicitar cadastro</h2>
          <p>Preencha os dados abaixo para solicitar acesso.</p>

          <div className={styles.grid}>
            <input name="nomeResponsavel" placeholder="Nome do responsável" value={form.nomeResponsavel} onChange={alterar} required />
            <input name="email" type="email" placeholder="E-mail" value={form.email} onChange={alterar} required />
            <input name="senha" type="password" placeholder="Senha" value={form.senha} onChange={alterar} required />
            <input name="razaoSocial" placeholder="Razão social" value={form.razaoSocial} onChange={alterar} />
            <input name="nomeFantasia" placeholder="Nome fantasia" value={form.nomeFantasia} onChange={alterar} />
            <input name="cnpj" placeholder="CNPJ" value={form.cnpj} onChange={alterar} />
            <input name="telefone" placeholder="Telefone" value={form.telefone} onChange={alterar} />
            <input name="whatsapp" placeholder="WhatsApp" value={form.whatsapp} onChange={alterar} />
          </div>

          <button type="submit">Enviar solicitação</button>

          <div className={styles.footer}>
            <span>Já possui acesso?</span>
            <Link to="/login">Entrar no portal</Link>
          </div>
        </form>
      </section>
    </div>
  );
}

export default Cadastro;