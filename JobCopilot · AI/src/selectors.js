// BOSS 直聘选择器（借鉴即投实测验证版）
const SELECTORS = {
  jobs: {
    jobCard: 'li.job-card-box, .job-card-wrapper',
    jobName: '.job-name, .job-title, [class*="job-name"]',
    jobSalary: '.job-salary, [class*="job-salary"]',
    jobLocation: '.job-area, .job-location, .job-address, [class*="job-area"], [class*="job-location"]',
    tagList: '.tag-list li, .job-card-footer li, .company-tag-list li',
    company: '.company-name a, .company-name, .boss-info .company-name, .company-info .company-name, [class*="company-name"]',
    immediateChatBtn: 'a.op-btn-chat, button.op-btn-chat',
    detailName: '.job-banner .name h1, .job-banner .name, .job-title, h1',
    detailSalary: '.job-banner .salary, .job-banner .name .salary, .job-salary',
    detailLocation: '.job-banner .job-address, .job-banner .job-location, .location-address, .job-address, [class*="job-location"]',
    detailCompany: '.company-info .company-name, .company-sider .company-name, .job-detail-company .company-name, .sider-company .company-name, .job-sider .sider-company .company-info a, .job-sider .company-info a',
    detailBody: '.job-sec-text, .job-detail-section, .job-detail-body, .job-detail-box .detail-content, .job-detail-box'
  },
  chat: {
    userList: '.user-list-content li',
    userName: '.geek-name, .name-text, [class*="name"]',
    userCompany: '.title-box .name-box, [class*="company"]',
    chatInput: 'div#chat-input.chat-input',
    btnSend: 'button.btn-send',
    imageUpload: '.btn-sendimg input[type=file]',
    messageSent: '.item-myself'
  }
};

const CITY_MAP = {
  '全国':'100010000','北京':'101010100','上海':'101020100','广州':'101280100','深圳':'101280600',
  '杭州':'101210100','成都':'101270100','武汉':'101200100','西安':'101110100','南京':'101190100',
  '苏州':'101190400','天津':'101030100','重庆':'101040100','长沙':'101250100','郑州':'101180100',
  '沈阳':'101070100','青岛':'101120200','合肥':'101220100','厦门':'101230200','福州':'101230100',
  '济南':'101120100','宁波':'101210400','东莞':'101281600','无锡':'101190200','昆明':'101290100',
  '哈尔滨':'101050100','长春':'101060100','大连':'101070200','石家庄':'101090100'
};
